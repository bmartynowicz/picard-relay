variable "tenancy_ocid" {
  type        = string
  description = "Your Oracle tenancy. Resource Manager supplies this value."
}
variable "compartment_ocid" {
  type        = string
  description = "Create only new Picard resources in this compartment."
}
variable "region" {
  type        = string
  description = "Your tenancy's home region."
}
variable "availability_domain" {
  type        = string
  description = "An availability domain with a Free micro slot."
}
variable "confirm_free" {
  type        = bool
  default     = false
  description = "I checked that my account and remaining allocation are eligible for Always Free, without paid resources."
}
variable "ssh_public_key" {
  type        = string
  default     = ""
  description = "Optional recovery public key. This stack never opens SSH ingress. Never enter a private key."
  validation {
    condition     = var.ssh_public_key == "" || can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+( [^\\r\\n]*)?$", var.ssh_public_key))
    error_message = "Use a public SSH key, or leave the optional field empty."
  }
}
