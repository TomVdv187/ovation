# Emits every TLS-interception root CA in the machine's trust store as PEM.
# Called by trust-local-tls.mjs; safe to run on its own.
$stores = @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root')
$seen = @{}
foreach ($store in $stores) {
    Get-ChildItem $store -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -match 'SSL/TLS scanning|Web/Mail Shield|Proxy|Interception|Antivirus' } |
        ForEach-Object {
            if (-not $seen.ContainsKey($_.Thumbprint)) {
                $seen[$_.Thumbprint] = $true
                '-----BEGIN CERTIFICATE-----'
                [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')
                '-----END CERTIFICATE-----'
            }
        }
}
