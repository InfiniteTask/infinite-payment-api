import app from "./app";
import { connectToMongoDB } from "./database";
import { messageQueue } from "./services/messageQueueService";
import { config } from "./config";

async function startServer() {
  const isMongoConnected = await connectToMongoDB();
  if (!isMongoConnected) {
    console.error("Failed to connect to MongoDB. Exiting...");
    process.exit(1);
  }

  // Connect to message queue (but don't fail if it's not available)
  await messageQueue.connect();

  app.listen(config.server.port, () => {
    console.log(`Payment service running on port ${config.server.port}`);
  });
}

startServer();
