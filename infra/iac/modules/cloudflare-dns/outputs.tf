# cloudflare_record.name may return only the bare label depending on provider
# version, so build the FQDN explicitly from the subdomain and zone.
output "app_fqdn" {
  value = "${var.app_subdomain}.${var.zone_name}"
}

output "lab_fqdn" {
  value = "${var.lab_subdomain}.${var.zone_name}"
}
