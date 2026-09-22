import { App } from 'aws-cdk-lib'
import { SiteStack } from '../lib/site-stack'

const app = new App()

new SiteStack(app, 'AceIslandsSite', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})
