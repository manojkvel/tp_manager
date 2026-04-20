@description('Container App name')
param name string

@description('Location')
param location string

@description('Container Apps environment id')
param environmentId string

@description('Container image')
param image string

@description('Target port')
param targetPort int

@description('Expose via external ingress (Front Door origin)')
param ingressExternal bool

@description('User-assigned managed identity resource id')
param identityId string

@description('Environment variables')
param envVars array = []

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: {
        external: ingressExternal
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'main'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: envVars
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: targetPort }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
            {
              type: 'Readiness'
              httpGet: { path: '/readyz', port: targetPort }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output appId string = app.id
