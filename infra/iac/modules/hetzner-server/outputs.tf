output "server_id" {
  description = "Hetzner server ID."
  value       = hcloud_server.origin.id
}

output "ipv4_address" {
  description = "Primary IPv4. Expected to be unused for ingress (tunnel-only) but needed for provider consoles and Tailscale."
  value       = hcloud_server.origin.ipv4_address
}

output "ipv6_address" {
  description = "Primary IPv6."
  value       = hcloud_server.origin.ipv6_address
}

output "name" {
  value = hcloud_server.origin.name
}
