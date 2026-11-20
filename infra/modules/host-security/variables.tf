variable "enable_mgmt_ssh" {
  description = "Allow SSH from mgmt_cidr at the host firewall. Default false: admin access is Tailscale/Cloudflare Access per ADR 0001. Enable only for the emergency path documented in infra/ddos/ufw-rules.sh."
  type        = bool
  default     = false
}

variable "mgmt_cidr" {
  description = "Management CIDR for the optional SSH allow rule. Required (and must not be 0.0.0.0/0) when enable_mgmt_ssh is true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_mgmt_ssh || (length(var.mgmt_cidr) > 0 && var.mgmt_cidr != "0.0.0.0/0" && var.mgmt_cidr != "::/0")
    error_message = "mgmt_cidr must be a specific CIDR (never 0.0.0.0/0) when enable_mgmt_ssh is true."
  }
}

variable "ssh_port" {
  description = "SSH port for the optional management rule."
  type        = number
  default     = 22
}

variable "apply_firewall" {
  description = "Apply the ufw default-deny posture in cloud-init. Defaults true; set false only when bootstrapping a host whose admin path is not yet confirmed (bootstrap.sh uses SPINDLE_APPLY_FIREWALL for the same reason)."
  type        = bool
  default     = true
}

variable "spindle_root" {
  description = "Stack root on the host. Matches SPINDLE_ROOT in infra/host/bootstrap.sh."
  type        = string
  default     = "/srv/spindle"
}
