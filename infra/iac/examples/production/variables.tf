variable "server_type" {
  description = "Hetzner Cloud server type. AX42 is dedicated (Robot); for Cloud use an equivalent like ccx33 or cpx51 depending on the move decision. Default is a placeholder, not a recommendation."
  type        = string
  default     = "ccx33"
}

variable "image" {
  description = "Hetzner image. Must be Ubuntu 24.04 LTS per the runbook."
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "Hetzner location. Runbook: Falkenstein (fsn1)."
  type        = string
  default     = "fsn1"
}

variable "zone_name" {
  description = "Cloudflare zone."
  type        = string
  default     = "spindle.app"
}

variable "tunnel_id" {
  description = "UUID of the spindle-prod tunnel from `cloudflared tunnel create` (runbook §2)."
  type        = string
}

variable "deploy_public_key" {
  description = "OpenSSH public key for admin/deploy access (via Tailscale/Access path)."
  type        = string
  sensitive   = true
}
