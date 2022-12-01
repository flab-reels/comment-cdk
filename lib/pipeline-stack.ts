import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcsDeployAction, GitHubSourceAction, GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Duration, SecretValue } from 'aws-cdk-lib';
import { BuildSpec, LinuxBuildImage, PipelineProject, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Peer, Port, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { NetworkLoadBalancer, Protocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { AwsLogDriver, Cluster, ContainerDefinition, ContainerImage, DeploymentControllerType, FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { EcsDeploymentConfig, EcsDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';

// 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
export class PipelineStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // change hehe
        
        // This is the main object which combines all the stages of the pipeline
        const pipeline = new codepipeline.Pipeline(this, 'comment-pipeline', {
            pipelineName : 'comment-pipeline',
            crossAccountKeys : false, // save 1$/month
        });

        /** 
         * Source Stage
         */
        // artifact will be stored in s3
        // The output artifact (any files to be built) from the previous step is ingested as an input artifact to the Build stage
        const sourceOutput = new Artifact();

        // initialize source action
        const sourceAction = new GitHubSourceAction({
            actionName : 'Comment_Github_Source',
            owner : 'flab-reels',
            repo : 'comment',
            oauthToken : SecretValue.secretsManager('pipeline-github-token'), // A GitHub OAuth token to use for authentication.
            branch : 'main',
            output : sourceOutput
        })

        pipeline.addStage({
            stageName : 'Source',
            actions : [sourceAction]
        })


        /**
         * Build Stage
         */
        // Set up a codebuild project that compiles the source code, and produces artifacts ready to deploy

        // initialize repository
        const ecr_repository = new Repository(this, 'CommentImageRepository', {
            repositoryName : 'comment-repository'
        })

        const project = new PipelineProject(this, 'CommentProject', {
            projectName : "CommentProject",
            environment : {
                buildImage : LinuxBuildImage.STANDARD_4_0,
                privileged : true,
            },
            environmentVariables : {
                ACCOUNT_ID: {
                    value: this.account
                },
                ACCOUNT_REGION: {
                    value: this.region
                },
                REPOSITORY_URI : {
                    value : ecr_repository.repositoryUri
                },
                IMAGE_TAG : {
                    value : 'latest'
                }
            },
            buildSpec : BuildSpec.fromObject({
                version : '0.2',
                phases : {
                    install: {
                        "runtime-versions": {
                            java: 'corretto11',
                        },
                    },
                    pre_build : {
                        commands: [
                            'echo Java version check',
                            'java --version',
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $ACCOUNT_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$ACCOUNT_REGION.amazonaws.com',
                            'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                            //'IMAGE_TAG=build-$(echo $CODEBUILD_BUILD_ID | awk -F":" \'{print $2}\')',
                            'chmod +x gradlew'
                        ]
                    },
                    build: {
                        commands: [
                            'echo Build started on `date`',
                            './gradlew bootBuildImage --imageName=$REPOSITORY_URI:$IMAGE_TAG',
                            'export imageTag=$IMAGE_TAG',
                            'echo imageTag=$IMAGE_TAG'
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo Pushing the Docker image...',
                            'docker push  $REPOSITORY_URI:$IMAGE_TAG',
                            "echo creating imagedefinitions.json dynamically",
                            'printf \'{"ImageURI":"%s"}\' $REPOSITORY_URI:$IMAGE_TAG > imageDetail.json',
                            'printf \'[{"name":"driver-service","imageUri":"%s"}]\' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json',
                            'echo Pushing Docker Image completed on `date`'
                        ]
                    }
                },
                artifacts: {
                    files: [
                        'imageDetail.json',
                        'imagedefinitions.json',
                    ]
                }
            })
        });

        project.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));

        // initialize build action
        const buildOutput = new Artifact();
        const buildAction = new CodeBuildAction({
            actionName : 'Comment_CodeBuild',
            project : project,
            input : sourceOutput,
            outputs : [buildOutput]
        })

        pipeline.addStage({
            stageName : 'Build',
            actions : [buildAction]
        })
        
        // a vpc is a logically isolated portion of aws cloud within a region
        // create your own vpc within aws account
        const vpc = new Vpc(this, 'comment-vpc', {
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

        const nlb = new NetworkLoadBalancer(this, 'comment-nlb', {
            vpc,
            internetFacing: true
        })

        const listener = nlb.addListener('comment-nlb-listener', {
            port : 80,
            protocol : Protocol.TCP
        })

        const cluster = new Cluster(this, "comment-cluster", {
            vpc: vpc
          });

        const fargateTaskDefinition = new FargateTaskDefinition(this, 'CommentTaskDef', {
            family : "comment-definition",
            memoryLimitMiB: 512,
            cpu: 256,
        });

        const container = fargateTaskDefinition.addContainer('CommentAppContainer', {
            containerName: "comment-container",
            image: ContainerImage.fromEcrRepository(ecr_repository),
        });

        container.addPortMappings({
            containerPort:8080,
            hostPort:8080,
        })

        // create security group
        const service_sg = new SecurityGroup(this, 'comment-service-sg', {
            description: 'Security group for comment service',
            vpc: cluster.vpc,
        });

        service_sg.addIngressRule(Peer.anyIpv4(), Port.tcp(80));
        service_sg.addIngressRule(Peer.anyIpv4(), Port.tcp(8080));

        const fargateService = new FargateService(this, 'comment-service', {
            cluster,
            taskDefinition : fargateTaskDefinition,
            serviceName : 'comment-service',
            securityGroups : [service_sg],
            deploymentController : {
                type : DeploymentControllerType.CODE_DEPLOY,
            }
        })

        // target group port doesnt seem to matter
        const blueTargetGroup = listener.addTargets('comment-tg-blue', {
            targetGroupName : 'comment-tg-blue',
            port : 80,
            targets : [fargateService]
        })

        const greenTargetGroup = listener.addTargets('comment-tg-green', {
            targetGroupName : 'comment-tg-green',
            port : 8080
        })

        const deployGroup = new EcsDeploymentGroup(this, 'CommentBlueeGreenDG', {
            service : fargateService,
            blueGreenDeploymentConfig :{
                blueTargetGroup,
                greenTargetGroup,
                listener,
                terminationWaitTime : Duration.minutes(5),
            },
            deploymentConfig : EcsDeploymentConfig.ALL_AT_ONCE,
        });

        // deploy action
        const deployAction =new EcsDeployAction({
            actionName : 'Comment_CodeDeploy',
            service : fargateService,
            imageFile : buildOutput.atPath('imageDetail.json')
        })

        pipeline.addStage({
            stageName : 'Deploy',
            actions : [deployAction]
        })



        // const deploy = new EcsDeploymentGroup(this, 'BlueGreenDG', {
        //     fargateService,
        //     blueGreenDeploymentConfig: {
        //         blueTargetGroup,
        //         greenTargetGroup,
        //         listener,
        //     },
        // });

        // define dependency between infra and cicd
        // fargateService.node.addDependency(pipeline);
    }
}
// code below generates dependency which is anti-pattern
// // The credential will be set as a global variable
// new GitHubSourceCredentials(this, 'CodeBuildGitHubCreds', {
//     accessToken: SecretValue.secretsManager('pipeline-github-token'),
// });

// const gitHubSource = Source.gitHub({
//     owner: 'flab-reels',
//     repo: 'comment',
//     webhook: true, // optional, default: true if `webhookFilters` were provided, false otherwise
//     webhookFilters: [
//       FilterGroup
//         .inEventOf(EventAction.PUSH)
//         .andBranchIs('main')
//     ], // optional, by default all pushes and Pull Requests will trigger a build
// });


// new Project(this, 'CommentProject', {
//     source: gitHubSource
// })


// const myService = new cdk.aws_ecs_patterns.NetworkLoadBalancedFargateService(this, 'Service', {
//     cluster,
//     memoryLimitMiB: 512,
//     cpu: 256,
//     taskImageOptions: {
//         image: ContainerImage.fromEcrRepository(ecr_repository),
//     },
// });

// // add health check
// myService.targetGroup.configureHealthCheck({
//     path: '/'
// })
