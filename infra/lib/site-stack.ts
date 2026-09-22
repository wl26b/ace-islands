import * as path from 'node:path'
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import type { Construct } from 'constructs'

/**
 * Hosting for the game: a private bucket holding the built files, and a
 * CloudFront distribution serving them over HTTPS from edge locations.
 *
 * The bucket is not public. CloudFront reaches it through an Origin Access
 * Control, which is a signed identity only the distribution holds, so the
 * only way to the files is through CloudFront. Public buckets are the
 * classic way to leak things by accident, and there is no reason for one
 * here.
 */
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // It holds nothing but build output, so it can be torn down with the
      // stack rather than left behind to be puzzled over later.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // The game only ever reads; no reason to forward anything else.
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: 'index.html',
      // One page, so anything unrecognised is still the game. This also
      // covers a deep link once there is ever routing.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      comment: 'Ace Islands',
      // The cheapest price class: edges in North America, Europe and Asia.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    })

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'dist'))],
      destinationBucket: bucket,
      distribution,
      // Vite fingerprints its assets, but index.html is not fingerprinted,
      // so the cache has to be cleared or a deploy would go unnoticed.
      distributionPaths: ['/*'],
    })

    new CfnOutput(this, 'SiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Where the game is served from',
    })

    new CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'The bucket holding the built files',
    })
  }
}
