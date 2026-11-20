output "server_id" {
  description = "Hetzner server ID of the origin."
  value       = hcloud_server.origin.id
}

output "server_ipv4" {
  description = "Public IPv4 of the origin. NOT an ingress path — the tunnel is outbound-only — but needed for Tailscale/Cloudflare Access enrollment and provider-console access."
  value       = hcloud_server.origin.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 of the origin."
  value       = hcloud_server.origin.ipv6_address
}

output "server_private_ip" {
  description = "Private IP on the spindle network."
  value       = var.server_private_ip
}

output "network_id" {
  description = "ID of the Hetzner private network."
  value       = hcloud_network.spindle.id
}

output "firewall_id" {
  description = "ID of the edge firewall attached to the server."
  value       = hcloud_firewall.spindle.id
}

output "bootstrap_command" {
  description = "Command to run on the new host to install Docker, ufw default-deny, and seed /srv/spindle (docs/runbooks/hosting.md §1)."
  value       = "sudo SPINDLE_APPLY_FIREWALL=1 ./infra/host/bootstrap.sh"
}
