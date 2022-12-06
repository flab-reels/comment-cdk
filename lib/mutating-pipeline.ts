import * as cdk from 'aws-cdk-lib';
import { App, SecretValue, Stack, StackProps, Stage, StageProps } from 'aws-cdk-lib';
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { Artifact, ArtifactPath, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, CodeDeployEcsDeployAction, EcsDeployAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { NetworkLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { EcsApplication, EcsDeploymentConfig, EcsDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';
import { Cluster, Compatibility, ContainerImage, DeploymentControllerType, FargateService, FargateTaskDefinition, TaskDefinition } from 'aws-cdk-lib/aws-ecs';



export class MutatingPipeline extends cdk.Stack {
    constructor(scope : Construct, id: string, props?: cdk.StackProps) {
        // provide your CI/CD account info her
        super(scope, 'Pipeline');

        // with AWS Codepipeline this will create Deployment pipeline
        // The basic pipeline declaration.

        // https://aws.amazon.com/blogs/developer/cdk-pipelines-continuous-delivery-for-aws-cdk-applications/

        // git practice
        
        // Source  – It fetches the source of your CDK app from your forked GitHub repo 
        // and triggers the pipeline every time you push new commits to it.
        const cdkpipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName : 'mutating-pipeline',
            crossAccountKeys : false,
            synth : new CodeBuildStep('SynthStep', { // it will be pointing the following github repo
                input : CodePipelineSource.gitHub('flab-reels/comment-cdk', 'main', {
                    authentication : SecretValue.secretsManager('pipeline-github-token'),
                }),
                installCommands : ['npm install -g aws-cdk'],
                //will genetate self mutating pipeline
                commands: [
                    'npm ci',
                    'npm run build',
                    'npx cdk synth --verbose'
                ]
            })
        });

        const myApp = new MyApplication(this, 'Deploy', {});
        cdkpipeline.addStage(myApp);
    }
}

class MyApplication extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);
        new DeployPipelineStack(this, 'NewDeploymentStack');
    }
}

class DeployPipelineStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const pipeline = new Pipeline(this, 'comment-pipeline', {
            pipelineName : 'comment-pipeline',
            crossAccountKeys : false, // save 1$/month
        });

        // Infra

        const vpc = new Vpc(this, 'sample-comment-vpc', {
            maxAzs : 2
        });

        const cluster = new Cluster(this, "sample-comment-cluster", {
            vpc: vpc
        });

        const taskDefinition = new TaskDefinition(this, 'TaskDefinition', {
            compatibility: Compatibility.FARGATE,
            cpu: '256',
            memoryMiB: '512',
        });

        const baseImage = 'public.ecr.aws/amazonlinux/amazonlinux:2022'
        // the task will fail because the image would not have been built
        const container = taskDefinition.addContainer('SampleCommentAppContainer', {
            containerName: "sample-comment-container",
            //image: ContainerImage.fromEcrRepository(this.my_repo),
            image: ContainerImage.fromRegistry(baseImage),
        });

        container.addPortMappings({
            containerPort:8080,
            hostPort:8080,
        })
        
        const service = new FargateService(this, 'comment-service', {
            cluster,
            taskDefinition,
            deploymentController: {
                type: DeploymentControllerType.CODE_DEPLOY,
            },
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
        const ecr_repository = new Repository(this, 'NewCommentImageRepository', {
            repositoryName : 'new-comment-repository-2'
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
                            'IMAGE_TAG=build-$(echo $CODEBUILD_BUILD_ID | awk -F":" \'{print $2}\')',
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

        // Deploy stage
        // create ecs service and set its deployment controller to codedeploy

        // create codedeploy app
        const application = new EcsApplication(this, 'CodeDeployApplication', {
            applicationName: 'MyApplication', // optional property
        });

        /**
         * Create Deployment TG
         */



        // specify appspec -> maybe built from code build
        // deploy

        // const deploymentGroup = EcsDeploymentGroup.fromEcsDeploymentGroupAttributes(pipeline, 'CommentBlueGreenDG', {
        //     application : application,
        //     deploymentGroupName: 'comment-deploy-group',
        //     // blueGreenDeploymentConfig: {
        //     //     blueTargetGroup,
        //     //     greenTargetGroup,
        //     //     listener,
        //     // },
        //     deploymentConfig: EcsDeploymentConfig.CANARY_10PERCENT_5MINUTES,
        // })
        const deployAction = new EcsDeployAction({
            actionName: 'deployAction',
            service: service,
            imageFile: new ArtifactPath(buildOutput, `imagedefinitions.json`)
        });

        pipeline.addStage({
            stageName : 'Deploy',
            actions: [deployAction]
        });

    }
}

// vpc, ecs, nlb, apigateway
class InfraStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

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
    }
}


// const listener = nlb.addListener('comment-nlb-listener', {
//     port : 80,
//     protocol : Protocol.TCP
// })

// const cluster = new Cluster(this, "comment-cluster", {
//     vpc: vpc
//   });

// const fargateTaskDefinition = new FargateTaskDefinition(this, 'CommentTaskDef', {
//     family : "comment-definition",
//     memoryLimitMiB: 512,
//     cpu: 256,
// });

// const container = fargateTaskDefinition.addContainer('CommentAppContainer', {
//     containerName: "comment-container",
//     image: ContainerImage.fromEcrRepository(ecr_repository),
// });

// container.addPortMappings({
//     containerPort:8080,
//     hostPort:8080,
// })

// // create security group
// const service_sg = new SecurityGroup(this, 'comment-service-sg', {
//     description: 'Security group for comment service',
//     vpc: cluster.vpc,
// });

// service_sg.addIngressRule(Peer.anyIpv4(), Port.tcp(80));
// service_sg.addIngressRule(Peer.anyIpv4(), Port.tcp(8080));

// const fargateService = new FargateService(this, 'comment-service', {
//     cluster,
//     taskDefinition : fargateTaskDefinition,
//     serviceName : 'comment-service',
//     securityGroups : [service_sg],
//     deploymentController : {
//         type : DeploymentControllerType.CODE_DEPLOY,
//     }
// })

// // target group port doesnt seem to matter
// const blueTargetGroup = listener.addTargets('comment-tg-blue', {
//     targetGroupName : 'comment-tg-blue',
//     port : 80,
//     targets : [fargateService]
// })

// const greenTargetGroup = listener.addTargets('comment-tg-green', {
//     targetGroupName : 'comment-tg-green',
//     port : 8080
// })

// const deployGroup = new EcsDeploymentGroup(this, 'CommentBlueeGreenDG', {
//     service : fargateService,
//     blueGreenDeploymentConfig :{
//         blueTargetGroup,
//         greenTargetGroup,
//         listener,
//         terminationWaitTime : Duration.minutes(5),
//     },
//     deploymentConfig : EcsDeploymentConfig.ALL_AT_ONCE,
// });

// // deploy action
// const deployAction =new EcsDeployAction({
//     actionName : 'Comment_CodeDeploy',
//     service : fargateService,
//     imageFile : buildOutput.atPath('imageDetail.json')
// })

// pipeline.addStage({
//     stageName : 'Deploy',
//     actions : [deployAction]
// })



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