terraform {
  required_version = ">= 1.5.0, < 1.6.0"
}
variable "observed" {
  type = object({
    region                = string
    home_region           = string
    micro_instances       = number
    storage_gb            = number
    available_micro_slots = number
    all_compartments_read = bool
    owner_confirmed_free  = bool
  })
  nullable = false
  validation {
    condition = alltrue([
      var.observed.micro_instances >= 0,
      floor(var.observed.micro_instances) == var.observed.micro_instances,
      var.observed.storage_gb >= 0,
      var.observed.available_micro_slots >= 0,
      var.observed.region != "",
      var.observed.home_region != ""
    ])
    error_message = "Oracle allowance observations must be complete nonnegative values."
  }
}
resource "terraform_data" "allowance" {
  input = var.observed
  lifecycle {
    precondition {
      condition     = var.observed.owner_confirmed_free && var.observed.all_compartments_read
      error_message = "Confirm your current Always Free eligibility and allow the complete tenancy inventory. No paid fallback is available."
    }
    precondition {
      condition     = var.observed.region == var.observed.home_region
      error_message = "Always Free deployment must use your Oracle home region."
    }
    precondition {
      condition     = var.observed.micro_instances < 2 && var.observed.available_micro_slots >= 1
      error_message = "No verified Free micro slot remains in this availability domain. Existing machines will not be changed."
    }
    precondition {
      condition     = var.observed.storage_gb + 50 <= 200
      error_message = "The 50 GB boot disk would exceed the 200 GB combined Free boot/block storage allowance."
    }
  }
}
output "eligible" {
  value      = true
  depends_on = [terraform_data.allowance]
}
