import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from 'aws-cdk-lib/aws-ecr'
import { Construct } from 'constructs';




export class CommentCdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // a vpc is a logically isolated portion of aws cloud within a region
        // create your own vpc within aws account
        const vpc = new ec2.Vpc(this, 'comment-vpc', {
            // define CIDR block
            // vpc subnets will have a longer subnet subnet masking (16) than the CIDB block
            maxAzs : 2
            // ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            // natGateways : 0,
            // availabilityZones : ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"],
            // subnetConfiguration: [
            //     {
            //         name: 'private-comment',
            //         subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            //         cidrMask: 24,
            //     },
            // ]
        });

        const nlb = new elbv2.NetworkLoadBalancer(this, 'comment-nlb', {
            vpc,
            internetFacing: true
        })

        nlb.addListener('comment-nlb-listener', {
            port : 8080,
            protocol : elbv2.Protocol.TCP
        })

        const cluster = new ecs.Cluster(this, "comment-cluster", {
            vpc: vpc
          });

        const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'CommentTaskDef', {
            family : "comment-definition",
            memoryLimitMiB: 512,
            cpu: 256,
        });

        // const container = fargateTaskDefinition.addContainer('CommentAppContainer', {
        //     containerName: "comment-container",
        //     image: "TODO",
        // });

        // container.addPortMappings({
        //     containerPort:8080,
        //     hostPort:8080,
        //     protocol: ecs.Protocol.TCP
        // })
        


        // security group
        // const securityGroup = new ec2.SecurityGroup(this, 'comment-security-group', {
        //     vpc,
        //     description: 'Allow access to ec2 instances',
        //     allowAllOutbound: true   // Can be set to false
        // });

        // consider pulling image from local ecr
        // https://www.easydeploy.io/blog/how-to-create-private-link-for-ecr-to-ecs-containers-to-save-nat-gatewayec2-other-charges/
        // securityGroup.addIngressRule(
        //     ec2.Peer.anyIpv4(),
        //     ec2.Port.tcp(80),
        //     ec2.Type
        // )

        // create api gateway
        // create ecr
        // create ecs pattern


    }
}

/**
 * 
 * The code below alone creates unnecessary resources in our case such as public subnet and nat
    const vpc = new ec2.Vpc(this, 'comment-vpc', {

        ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
});
 */
