variable "zone_name" {
  description = "Cloudflare zone, e.g. spindle.app."
  type        = string
  default     = "spindle.app"
}

variable "tunnel_id" {
  description = "UUID of the cloudflared tunnel these records point at (spindle-prod or spindle-staging)."
  type        = string
}

variable "app_subdomain" {
  description = "App hostname label, e.g. app or staging."
  type        = string
}

variable "lab_subdomain" {
  description = "Lab hostname label, e.g. lab or staging-lab."
  type        = string
}
