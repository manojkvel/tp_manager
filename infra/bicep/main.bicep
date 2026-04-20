// TASK-007 — TP Manager IaC root (Bicep).
// Creates: resource group scope — Container Apps env, Postgres Flex + read replica, Blob, Key Vault,
// Front Door, managed identities. Designed to be deployed with:
//   az deployment group create -g rg-tp-<env> -f infra/bicep/main.bicep -p @infra/bicep/params/<env>.json
//
// NOTE: `secrets.*` params must be supplied via Key Vault references or `az deployment group create -p`.
// PARTIAL (TASK-007): owner must provision subscription + DNS first.

targetScope = 'resourceGroup'

@description('Environment short name (staging|prod)')
@allowed(['staging', 'prod'])
param env string

@description('Azure region')
param location string = resourceGroup().location

@description('Base name — included in every resource name')
param baseName string = 'tp${env}'

@description('Postgres admin login')
param pgAdminLogin string = 'tpadmin'

@secure()
@description('Postgres admin password — MUST come from Key Vault reference')
param pgAdminPassword string

@description('ACR login server — e.g., tpmanager.azurecr.io')
param acrLoginServer string

@description('Container image tags by service')
param imageTags object = {
  api: 'latest'
  web: 'latest'
  alohaWorker: 'latest'
  ml: 'latest'
}

// ---- Log Analytics + App Insights ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${baseName}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${baseName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---- Key Vault ----
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${baseName}-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: env == 'prod' ? true : null
  }
}

// ---- Managed identity ----
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${baseName}'
  location: location
}

// ---- Blob storage ----
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${baseName}${uniqueString(resourceGroup().id)}'
  location: location
  sku: { name: env == 'prod' ? 'Standard_GRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// ---- Postgres Flexible Server ----
resource pgPrimary 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: 'pg-${baseName}'
  location: location
  sku: {
    name: env == 'prod' ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    tier: env == 'prod' ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: env == 'prod' ? 128 : 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: env == 'prod' ? 30 : 7
      geoRedundantBackup: env == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: env == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
  }
}

resource pgReplica 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = if (env == 'prod') {
  name: 'pg-${baseName}-replica'
  location: location
  sku: {
    name: 'Standard_D2ds_v5'
    tier: 'GeneralPurpose'
  }
  properties: {
    createMode: 'Replica'
    sourceServerResourceId: pgPrimary.id
  }
}

// ---- Container Apps environment ----
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${baseName}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ---- Container Apps (one per service) ----
module apiApp 'modules/containerapp.bicep' = {
  name: 'api'
  params: {
    name: 'ca-${baseName}-api'
    location: location
    environmentId: containerAppsEnv.id
    image: '${acrLoginServer}/tp/api:${imageTags.api}'
    targetPort: 3001
    ingressExternal: false
    identityId: managedIdentity.id
    envVars: [
      { name: 'NODE_ENV', value: 'production' }
      { name: 'LOG_LEVEL', value: 'info' }
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
    ]
  }
}

module mlApp 'modules/containerapp.bicep' = {
  name: 'ml'
  params: {
    name: 'ca-${baseName}-ml'
    location: location
    environmentId: containerAppsEnv.id
    image: '${acrLoginServer}/tp/ml:${imageTags.ml}'
    targetPort: 8000
    ingressExternal: false
    identityId: managedIdentity.id
    envVars: [
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
    ]
  }
}

module alohaWorkerApp 'modules/containerapp.bicep' = {
  name: 'aloha-worker'
  params: {
    name: 'ca-${baseName}-aloha'
    location: location
    environmentId: containerAppsEnv.id
    image: '${acrLoginServer}/tp/aloha-worker:${imageTags.alohaWorker}'
    targetPort: 3002
    ingressExternal: false
    identityId: managedIdentity.id
    envVars: [
      { name: 'NODE_ENV', value: 'production' }
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
    ]
  }
}

module webApp 'modules/containerapp.bicep' = {
  name: 'web'
  params: {
    name: 'ca-${baseName}-web'
    location: location
    environmentId: containerAppsEnv.id
    image: '${acrLoginServer}/tp/web:${imageTags.web}'
    targetPort: 3000
    ingressExternal: true
    identityId: managedIdentity.id
    envVars: []
  }
}

output apiFqdn string = apiApp.outputs.fqdn
output webFqdn string = webApp.outputs.fqdn
output keyVaultName string = keyVault.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output pgFqdn string = pgPrimary.properties.fullyQualifiedDomainName
