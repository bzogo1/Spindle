# host-security — renders the host-level hardening for a Spindle origin.
#
# Produces a cloud-init user-data payload (YAML) that an operator or another
# Terraform module can attach to the server, OR that can be applied manually.
# The rules mirror two existing sources of truth:
#
#   - infra/host/bootstrap.sh        — ufw default deny incoming / allow
#                                       outgoing, unattended-upgrades,
#                                       chrony, Docker daemon defaults.
#   - infra/ddos/ufw-rules.sh         — optional SSH-from-mgmt-CIDR rule and
#                                       explicit denies for public 80/443.
#
# The module does NOT provision the compose stack, tunnel credentials, or
# host.env — those are secrets and operator steps per docs/runbooks/hosting.md.
# It only encodes the firewall and base-package posture so a rebuilt host is
# never left with a permissive default.

locals {
  # Single source for the rendered payload. The template lives inline so the
  # module is self-contained; keep it in sync with infra/host/bootstrap.sh.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    mgmt_ssh_enabled = var.enable_mgmt_ssh ? "true" : "false"
    mgmt_cidr        = var.mgmt_cidr
    ssh_port         = var.ssh_port
    spindle_root     = var.spindle_root
    apply_firewall   = var.apply_firewall ? "true" : "false"
  })
}
