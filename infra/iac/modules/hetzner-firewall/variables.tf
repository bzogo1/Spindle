variable "name" {
  description = "Firewall name, e.g. spindle-prod-fw."
  type        = string
}

variable "management_cidr" {
  description = "Single IPv4/IPv6 CIDR allowed to reach SSH. Null (default) means no SSH allow rule — the normal posture."
  type        = string
  default     = null
  validation {
    condition     = var.management_cidr == null || can(cidrnetmask(var.management_cidr))
    error_message = "management_cidr must be null or a valid CIDR."
  }
}
