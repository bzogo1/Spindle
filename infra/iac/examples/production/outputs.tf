output "origin_ipv4" {
  description = "Origin IPv4 — for Tailscale/Access allowlists and provider consoles, NOT for public ingress."
  value       = module.origin.ipv4_address
}

output "origin_name" {
  value = module.origin.name
}

output "firewall_id" {
  value = module.firewall.firewall_id
}

output "app_url" {
  value = "https://${module.dns.app_fqdn}"
}

output "lab_url" {
  value = "https://${module.dns.lab_fqdn}"
}
