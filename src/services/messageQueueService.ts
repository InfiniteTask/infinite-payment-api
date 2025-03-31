import * as amqp from "amqplib";
import { config } from "../config";
import { PaymentEvent } from "../types";
import { eventsCollection } from "../database";

export class MessageQueueService {
  private channel: amqp.Channel | null = null;
  private isConnected = false;
  private eventStore: PaymentEvent[] = [];

  async connect(): Promise<void> {
    try {
      const connection = await amqp.connect(config.rabbitmq.url);
      this.channel = await connection.createChannel();
      await this.channel.assertQueue(config.rabbitmq.queueName, {
        durable: true
      });
      this.isConnected = true;
      console.log("Connected to RabbitMQ");

      // Process any stored events that haven't been sent to RabbitMQ
      await this.processStoredEvents();
    } catch (error) {
      console.warn(
        "Failed to connect to RabbitMQ, will use local event store:",
        error
      );
      this.isConnected = false;
    }
  }

  async sendMessage(queueName: string, message: any): Promise<void> {
    if (this.isConnected && this.channel) {
      this.channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
      );
    } else {
      // Fallback: Store in MongoDB for later processing
      await eventsCollection.insertOne({
        queue: queueName,
        message,
        createdAt: new Date(),
        processed: false
      });

      // Also keep in memory for quick access
      if (queueName === config.rabbitmq.queueName) {
        this.eventStore.push(message as PaymentEvent);
      }

      console.log(`[MOCK] Message stored for ${queueName}:`, message);
    }
  }

  async processStoredEvents(): Promise<void> {
    if (!this.isConnected || !this.channel) return;

    try {
      const unprocessedEvents = await eventsCollection
        .find({ processed: false })
        .toArray();

      for (const event of unprocessedEvents) {
        this.channel.sendToQueue(
          event.queue,
          Buffer.from(JSON.stringify(event.message)),
          { persistent: true }
        );

        await eventsCollection.updateOne(
          { _id: event._id },
          { $set: { processed: true, processedAt: new Date() } }
        );

        console.log(`Sent stored event to queue ${event.queue}`);
      }
    } catch (error) {
      console.error("Error processing stored events:", error);
    }
  }

  getStoredEvents(): PaymentEvent[] {
    return this.eventStore;
  }
}

export const messageQueue = new MessageQueueService();
