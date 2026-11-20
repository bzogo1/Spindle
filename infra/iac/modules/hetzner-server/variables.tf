variable "name" {
  description = "Server name, e.g. spindle-prod."
  type        = string
}

variable "environment" {
  description = "prod or staging."
  type        = string
  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be prod or staging."
  }
}

variable "server_type" {
  description = "Hetzner Cloud server type (CX/CPX/CCX only). AX41/AX42-class machines are Hetzner Robot dedicated SKUs and cannot be created via hcloud — see docs/infrastructure/iac.md. Staging: CPX31-class."
  type        = string
  default     = "ccx33"
}

variable "image" {
  description = "Hetzner image name. The runbook requires Ubuntu 24.04 LTS."
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "Hetzner location. Production runbook: Falkenstein (fsn1)."
  type        = string
  default     = "fsn1"
}

variable "deploy_public_key" {
  description = "OpenSSH public key for the deploy/admin user. Private key stays off-repo."
  type        = string
  sensitive   = true
}

variable "firewall_ids" {
  description = "IDs of hcloud_firewall resources to attach. Required: without a firewall the stock Ubuntu image exposes sshd:22 to the internet — there is no implicit default-deny at the provider edge."
  type        = list(number)
}

variable "labels" {
  description = "Extra labels applied to the server."
  type        = map(string)
  default     = {}
}

variable "prevent_destroy" {
  description = "Set true for production to block accidental terraform destroy."
  type        = bool
  default     = false
}
