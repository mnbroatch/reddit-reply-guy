const { EC2Client, DescribeInstancesCommand } = require( "@aws-sdk/client-ec2");
const { CloudWatchClient, GetMetricStatisticsCommand } = require( "@aws-sdk/client-cloudwatch");

// Create EC2 and CloudWatch clients
const ec2Client = new EC2Client({ region: "us-east-1" }); // replace with your region
const cloudWatchClient = new CloudWatchClient({ region: "us-east-1" });

// Function to describe EC2 instances
const getEC2Instances = async () => {
  try {
    const data = await ec2Client.send(new DescribeInstancesCommand({}));
    return data.Reservations?.flatMap(reservation => reservation.Instances) || [];
  } catch (error) {
    console.error("Error fetching EC2 instances:", error);
  }
};

// Function to get CPU credit balance for a given instance
const getCPUCreditBalance = async (instanceId) => {
  const params = {
    MetricName: "CPUCreditBalance", // The metric to check
    Namespace: "AWS/EC2",
    Dimensions: [
      {
        Name: "InstanceId",
        Value: instanceId,
      },
    ],
    StartTime: new Date(new Date().getTime() - 3600 * 1000), // 1 hour ago
    EndTime: new Date(),
    Period: 60, // 1-minute granularity
    Statistics: ["Average"],
  };

  try {
    const data = await cloudWatchClient.send(new GetMetricStatisticsCommand(params));
    return data.Datapoints[data.Datapoints.length - 1].Average;
  } catch (error) {
    console.error("Error fetching CloudWatch metrics:", error);
  }
};

// Main function to fetch instances and their CPU credit balance
const main = async () => {
  const instance = (await getEC2Instances())
    .filter((instance) => instance.State.Name === 'running')[0];
  return getCPUCreditBalance(instance.InstanceId);
};

module.exports = main
