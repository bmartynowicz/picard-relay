output "relay_address" {
  value       = "https://picard-${replace(oci_core_instance.relay.public_ip, ".", "-")}.sslip.io/"
  description = "Your relay. Wait for first boot and its HTTPS certificate."
}
output "create_your_password" {
  value       = "https://picard-${replace(oci_core_instance.relay.public_ip, ".", "-")}.sslip.io/#claim=${local.claim_code}"
  sensitive   = true
  description = "Private one-hour setup link. Reveal in Oracle and open it to create your password, then connect Groq. Do not share this link."
}
output "next_step" {
  value = "Wait for first boot, reveal Create your password, and open its private HTTPS link. Your password and Groq key are entered only on your relay. Setup sends no AI request."
}
