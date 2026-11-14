data "oci_identity_region_subscriptions" "regions" {
  tenancy_id = var.tenancy_ocid
}
data "oci_identity_compartments" "all" {
  compartment_id            = var.tenancy_ocid
  compartment_id_in_subtree = true
  access_level              = "ANY"
  state                     = "ACTIVE"
}
data "oci_identity_availability_domains" "all" {
  compartment_id = var.tenancy_ocid
}
locals {
  compartments  = toset(slice(concat([var.tenancy_ocid], [for c in data.oci_identity_compartments.all.compartments : c.id]), 0, min(65, 1 + length(data.oci_identity_compartments.all.compartments))))
  volume_scopes = { for pair in setproduct(local.compartments, toset([for ad in data.oci_identity_availability_domains.all.availability_domains : ad.name])) : join("/", pair) => { compartment = pair[0], ad = pair[1] } }
  micro_count   = length(flatten([for c in data.oci_core_instances.inventory : [for i in c.instances : i.id if i.shape == "VM.Standard.E2.1.Micro" && i.state != "TERMINATED"]]))
  boot_gb       = sum(concat([0], flatten([for scope in data.oci_core_boot_volumes.inventory : [for v in scope.boot_volumes : v.size_in_gbs if v.state != "TERMINATED"]])))
  block_gb      = sum(concat([0], flatten([for c in data.oci_core_volumes.inventory : [for v in c.volumes : v.size_in_gbs if v.state != "TERMINATED"]])))
  home_region   = one([for r in data.oci_identity_region_subscriptions.regions.region_subscriptions : r.region_name if r.is_home_region])
}
data "oci_core_instances" "inventory" {
  for_each       = local.compartments
  compartment_id = each.value
}
data "oci_core_volumes" "inventory" {
  for_each       = local.compartments
  compartment_id = each.value
}
data "oci_core_boot_volumes" "inventory" {
  for_each            = local.volume_scopes
  compartment_id      = each.value.compartment
  availability_domain = each.value.ad
}
data "oci_limits_resource_availability" "micro" {
  compartment_id      = var.tenancy_ocid
  service_name        = "compute"
  limit_name          = "standard-e2-micro-core-count"
  availability_domain = var.availability_domain
}
module "free_guard" {
  source = "./free-guard"
  observed = {
    region                = var.region
    home_region           = local.home_region
    micro_instances       = local.micro_count
    storage_gb            = local.boot_gb + local.block_gb
    available_micro_slots = data.oci_limits_resource_availability.micro.available
    all_compartments_read = length(data.oci_identity_compartments.all.compartments) < 64 && alltrue([for c in data.oci_identity_compartments.all.compartments : c.is_accessible])
    owner_confirmed_free  = var.confirm_free
  }
}
data "oci_core_images" "platform" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = "VM.Standard.E2.1.Micro"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}
locals {
  platform_images = [for i in data.oci_core_images.platform.images : i if(i.compartment_id == null || i.compartment_id == "") && i.state == "AVAILABLE"]
}
resource "random_id" "owner_claim" {
  byte_length = 32
}
locals {
  claim_code = trim(random_id.owner_claim.b64_url, "=")
}
resource "terraform_data" "reviewed_package" {
  input = local.picard_artifact_sha256
  lifecycle {
    precondition {
      condition     = can(regex("^[a-f0-9]{64}$", local.picard_artifact_sha256)) && local.picard_artifact_url == "https://bmartynowicz.github.io/picard-relay/oracle-host-${local.picard_artifact_sha256}.tgz"
      error_message = "Use the reviewed published Oracle package from Picard's website. Unpackaged source cannot provision resources."
    }
  }
}
resource "oci_core_vcn" "relay" {
  compartment_id = var.compartment_ocid
  display_name   = "picard-relay"
  cidr_blocks    = ["10.247.0.0/24"]
  depends_on     = [module.free_guard, terraform_data.reviewed_package]
}
resource "oci_core_internet_gateway" "relay" {
  compartment_id = var.compartment_ocid
  display_name   = "picard-relay"
  vcn_id         = oci_core_vcn.relay.id
  enabled        = true
}
resource "oci_core_route_table" "relay" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.relay.id
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.relay.id
  }
}
resource "oci_core_security_list" "relay" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.relay.id
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}
resource "oci_core_subnet" "relay" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.relay.id
  cidr_block                 = "10.247.0.0/26"
  route_table_id             = oci_core_route_table.relay.id
  security_list_ids          = [oci_core_security_list.relay.id]
  prohibit_public_ip_on_vnic = false
}
resource "oci_core_instance" "relay" {
  compartment_id      = var.compartment_ocid
  availability_domain = var.availability_domain
  display_name        = "picard-relay"
  shape               = "VM.Standard.E2.1.Micro"
  create_vnic_details {
    subnet_id        = oci_core_subnet.relay.id
    assign_public_ip = true
  }
  source_details {
    source_type             = "image"
    source_id               = try(local.platform_images[0].id, "")
    boot_volume_size_in_gbs = 50
    boot_volume_vpus_per_gb = 10
  }
  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.tftpl", {
      claim_sha256  = sha256(local.claim_code)
      source_url    = local.picard_artifact_url
      source_sha256 = local.picard_artifact_sha256
    }))
  }
  preserve_boot_volume = true
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [source_details[0].source_id, metadata]
    precondition {
      condition     = length(local.platform_images) > 0 && module.free_guard.eligible
      error_message = "No eligible official Oracle Linux 9 micro image or verified Free allowance is available."
    }
  }
}
