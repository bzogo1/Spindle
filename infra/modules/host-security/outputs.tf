output "user_data" {
  description = "Rendered cloud-init user-data (YAML). Attach as hcloud_server.user_data or apply manually on first boot."
  value       = local.user_data
}

output "apply_firewall" {
  description = "Effective firewall posture baked into the payload."
  value       = var.apply_firewall
}

output "mgmt_ssh_enabled" {
  description = "Whether the payload opens SSH from mgmt_cidr (emergency path only)."
  value       = var.enable_mgmt_ssh
}
