variable "environment" {
  description = "Environment name (prod, staging). Used in labels and default names."
  type        = string
}

variable "location" {
  description = "Hetzner location. Falkenstein per ADR 0001 (fsn1)."
  type        = string
  default     = "fsn1"
}

variable "server_type" {
  description = "Hetzner server type. AX42-1 for production, CPX31/AX41 for staging (docs/runbooks/hosting.md §1)."
  type        = string
  default     = "ax42"
}

variable "image" {
  description = "OS image. Ubuntu 24.04 LTS per ADR 0001."
  type        = string
  default     = "ubuntu-24.04"
}

variable "ssh_key_ids" {
  description = "Hetzner SSH key IDs for the deploy/admin keypair. Keys are managed out of band; never pass private key material."
  type        = list(number)
  default     = []
}

variable "network_name" {
  description = "Name of the Hetzner private network."
  type        = string
  default     = null # defaults to spindle-<environment>
}

variable "network_cidr" {
  description = "CIDR for the private network."
  type        = string
  default     = "10.42.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR for the cloud subnet inside the private network."
  type        = string
  default     = "10.42.1.0/24"
}

variable "network_zone" {
  description = "Hetzner network zone. Must match the server's location zone (fsn1 -> eu-central)."
  type        = string
  default     = "eu-central"
}

variable "server_private_ip" {
  description = "Static private IP for the server inside the subnet. Hetzner requires an explicit IP when attaching a network."
  type        = string
  default     = "10.42.1.10"
}

variable "firewall_name" {
  description = "Name of the edge firewall."
  type        = string
  default     = null # defaults to spindle-<environment>-fw
}

variable "enable_mgmt_ssh" {
  description = "Open TCP/22 at the edge firewall from mgmt_cidr. Default false: admin access is Tailscale/Cloudflare Access; enable only for the emergency path documented in infra/ddos/ufw-rules.sh."
  type        = bool
  default     = false
}

variable "mgmt_cidr" {
  description = "Single IPv4/IPv6 CIDR allowed to reach SSH when enable_mgmt_ssh is true. Must never be 0.0.0.0/0 — enforced by validation."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_mgmt_ssh || (length(var.mgmt_cidr) > 0 && var.mgmt_cidr != "0.0.0.0/0" && var.mgmt_cidr != "::/0")
    error_message = "mgmt_cidr must be a specific CIDR (never 0.0.0.0/0) when enable_mgmt_ssh is true."
  }
}

variable "server_name" {
  description = "Hostname of the server."
  type        = string
  default     = null # defaults to spindle-<environment>-origin
}
