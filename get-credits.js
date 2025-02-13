const { EC2Client, DescribeInstanceCreditSpecificationsCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const axios = require('axios');

// Function to get the instance ID of the EC2 instance (with IMDSv2 support)
async function getInstanceId() {
  try {
    const tokenResponse = await axios.put('http://169.254.169.254/latest/api/token', null, {
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }, // Token TTL of 6 hours
    });

    const token = tokenResponse.data;

    const instanceIdResponse = await axios.get('http://169.254.169.254/latest/meta-data/instance-id', {
      headers: { 'X-aws-ec2-metadata-token': token },
    });

    return instanceIdResponse.data;
  } catch (error) {
    throw new Error('Error fetching instance metadata: ' + error.message);
  }
}

// Function to get the current CPU credit balance from CloudWatch
async function getCpuCreditBalance() {
  const instanceId = await getInstanceId(); // Get the current EC2 instance ID

  // Set up CloudWatch client
  const cloudWatchClient = new CloudWatchClient({ region: 'us-east-1' }); // Specify the appropriate region

  const params = {
    MetricName: 'CPUCreditBalance',
    Namespace: 'AWS/EC2',
    Dimensions: [
      {
        Name: 'InstanceId',
        Value: instanceId,
      },
    ],
    StartTime: new Date(new Date().getTime() - 1000 * 60 * 30),
    EndTime: new Date(),
    Period: 60,
    Statistics: ['Average'],
  };

  const command = new GetMetricStatisticsCommand(params);

  try {
    const data = await cloudWatchClient.send(command);

    if (data.Datapoints.length > 0) {
      const latestDatapoint = data.Datapoints[data.Datapoints.length - 1];
      return latestDatapoint.Average
    } else {
      console.log('No data points available for CPU Credit Balance.');
      return 0
    }
  } catch (error) {
    console.error('Error retrieving CPU credit balance from CloudWatch:', error);
  }
}

module.exports = getCpuCreditBalance
