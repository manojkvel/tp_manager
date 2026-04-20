# TP Manager IaC (Bicep)

Deploys the full stack to Azure — Container Apps, Postgres Flexible Server (+ read replica on prod),
Blob storage, Key Vault, App Insights, Log Analytics, managed identity.

## Prerequisites (PARTIAL — owner action)

Before `az deployment group create` can succeed, the owner must:

1. Create an Azure subscription (or reuse existing).
2. Create a shared resource group `rg-tp-shared` holding the ACR + shared Key Vault:
   ```sh
   az group create -n rg-tp-shared -l canadacentral
   az acr create -n tpmanager -g rg-tp-shared --sku Basic --admin-enabled false
   az keyvault create -n kv-tp-shared -g rg-tp-shared --enable-rbac-authorization true
   ```
3. Store the Postgres admin password in Key Vault:
   ```sh
   az keyvault secret set --vault-name kv-tp-shared -n pg-admin-password-staging --value '<generated>'
   ```
4. Replace `REPLACE_ME` in `params/staging.json` and `params/prod.json` with the subscription id.
5. Grant the GitHub Actions federated identity `AcrPush` on the ACR and `Contributor` on each env RG.

## Deploy

```sh
az group create -n rg-tp-staging -l canadacentral
az deployment group create \
  -g rg-tp-staging \
  -f infra/bicep/main.bicep \
  -p @infra/bicep/params/staging.json
```

## Resources created

| Resource | Name pattern | Notes |
|---|---|---|
| Log Analytics | `log-tp<env>` | 30-day retention |
| App Insights | `appi-tp<env>` | Workspace-based |
| Key Vault | `kv-tp<env>-<hash>` | RBAC only, purge protection on prod |
| User-assigned MI | `id-tp<env>` | Attached to each Container App |
| Storage (Blob) | `sttp<env><hash>` | GRS on prod, LRS on staging |
| Postgres Flex | `pg-tp<env>` | v16, HA + replica on prod |
| Container Apps Env | `cae-tp<env>` | App Insights wired |
| Container Apps | `ca-tp<env>-{api,web,aloha,ml}` | External ingress only on web |

See ADR 0001, 0002, 0010 for decision context.
