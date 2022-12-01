import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { Repository } from 'aws-cdk-lib/aws-ecr';

export interface DemoInfraStackProps extends cdk.StackProps { repository: Repository };
export class DemoInfraStack extends cdk.Stack {

    public readonly ecr_repository : Repository;

    constructor(scope: Construct, id: string, props?: DemoInfraStackProps) {
        super(scope, id, props);
        
        // a vpc is a logically isolated portion of aws cloud within a region
        // create your own vpc within aws account
        const vpc = new Vpc(this, 'comment-vpc', {
            maxAzs : 2
        });

        const cluster = new Cluster(this, "comment-cluster", {
            vpc: vpc,
            clusterName : "comment-cluster"
        });

        new cdk.aws_ecs_patterns.NetworkLoadBalancedFargateService(this, 'Service', {
            cluster,
            memoryLimitMiB: 512,
            cpu: 256,
            taskImageOptions: {
                image: ContainerImage.fromEcrRepository(this.ecr_repository),
            },
        });
    }
}