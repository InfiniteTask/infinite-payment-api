// payment-service/index.ts
import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler
} from "express";
import { v4 as uuidv4 } from "uuid";
import bodyParser from "body-parser";
import * as amqp from "amqplib";
import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // Import node-fetch

dotenv.config();
// Types
interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
}

interface PaymentResponse {
  paymentId: string;
  status: string;
}

interface PaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

interface PaymentEvent {
  event: string;
  data: {
    paymentId: string;
    amount: number;
    currency: string;
    customerId: string;
    wisePaymentId: string;
    status: string;
  };
}

interface IdempotentRequest extends Request {
  idempotencyKey?: string;
}

interface StoredRequest {
  idempotencyKey: string;
  response: PaymentResponse;
  createdAt: Date;
}

interface StoredEvent {
  queue: string;
  message: any;
  createdAt: Date;
  processed?: boolean;
}

interface RecipientRequest {
  name: string;
  accountNumber: string;
  ifscCode: string;
  email: string;
  customerId: string;
  wiseProfileId?: number; // now this is created by us
  wiseAccountId?: number; // We might not have it yet
  currency: string; // Add currency
  // Profile Data
  firstName: string;
  lastName: string;
  addressFirstLine: string;
  city: string;
  countryIso3Code: string;
  postCode: string;
  stateCode: string;
  nationality: string;
  dateOfBirth: string;
}

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "payments";

let db: Db;
let requestsCollection: Collection<StoredRequest>;
let eventsCollection: Collection<StoredEvent>;
let paymentsCollection: Collection;
let recipientsCollection: Collection; // Added recipients collection

// Wise API Keys (replace with your actual API key and profile ID)
const WISE_API_KEY = process.env.WISE_API_KEY;
const WISE_PROFILE_ID = process.env.WISE_PROFILE_ID;
const WISE_API_URL = process.env.WISE_API_URL;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db(DB_NAME);
    requestsCollection = db.collection("requests");
    eventsCollection = db.collection("events");
    paymentsCollection = db.collection("payments");
    recipientsCollection = db.collection("recipients"); // Initialize recipients collection

    // Create indexes for faster queries
    await requestsCollection.createIndex(
      { idempotencyKey: 1 },
      { unique: true }
    );
    await recipientsCollection.createIndex({ customerId: 1 }); // Index for recipients
    await recipientsCollection.createIndex(
      { wiseAccountId: 1 },
      { unique: true }
    );
    await recipientsCollection.createIndex(
      { wiseProfileId: 1 },
      { unique: true }
    );

    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());
// Idempotency middleware
const idempotencyMiddleware: RequestHandler = async (
  req: IdempotentRequest,
  res: Response,
  next: NextFunction
) => {
  const idempotencyKey = req.headers["idempotency-key"] as string;

  if (!idempotencyKey) {
    res.status(400).json({ error: "Idempotency key required" });
    return;
  }

  // Check if this request was already processed
  const existingRequest = await requestsCollection.findOne({ idempotencyKey });
  if (existingRequest) {
    res.status(200).json(existingRequest.response);
    return;
  }

  req.idempotencyKey = idempotencyKey;
  next();
};

// Mock Message Queue Service
class MessageQueueService {
  private channel: amqp.Channel | null = null;
  private isConnected = false;
  private eventStore: PaymentEvent[] = [];

  async connect(): Promise<void> {
    try {
      const connection = await amqp.connect("amqp://localhost");
      this.channel = await connection.createChannel();
      await this.channel.assertQueue("payment_events", { durable: true });
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
      if (queueName === "payment_events") {
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

const messageQueue = new MessageQueueService();

// Payment endpoint with idempotency
app.post(
  "/api/payments",
  idempotencyMiddleware,
  async (req: IdempotentRequest, res: Response) => {
    try {
      console.log(req.body, "req body in payments");
      const { amount, currency, customerId } = req.body as PaymentRequest;
      const paymentId = uuidv4();

      const fetchedAccountDetails = await fetch(
        `${WISE_API_URL}/v1/profiles/${WISE_PROFILE_ID}/account-details`,
        {
          headers: {
            Authorization: `Bearer ${WISE_API_KEY}`
          }
        }
      );
      const accountDetailsData: any = await fetchedAccountDetails.json();
      console.log(accountDetailsData, "account details data in payments");
      const fetchedRecipients = await fetch(
        `${WISE_API_URL}/v2/accounts?profile=${WISE_PROFILE_ID}&currency=INR`,
        {
          headers: {
            Authorization: `Bearer ${WISE_API_KEY}`
          }
        }
      );
      const recipientsData: any = await fetchedRecipients.json();
      console.log(recipientsData, "recipients data");
      if (recipientsData.length === 0) {
        throw new Error("No recipients found");
      }
      // Mock Stripe API call - REPLACED with Wise Quote
      const quote = await getWiseQuote(
        currency,
        "INR",
        amount,
        recipientsData.content[0].id,
        Number(WISE_PROFILE_ID)
      );

      console.log(quote, "quote from wise");

      // Store payment in database
      await paymentsCollection.insertOne({
        paymentId,
        amount,
        currency,
        customerId: recipientsData.content[0].id,
        wisePaymentId: quote.id, // Storing quote ID
        status: "succeeded", // Assuming quote retrieval means success
        createdAt: new Date()
      });

      // Publish event to queue
      const paymentEvent: PaymentEvent = {
        event: "payment.created",
        data: {
          paymentId,
          amount,
          currency,
          customerId: recipientsData.content[0].id,
          wisePaymentId: quote.id, // Quote ID
          status: "succeeded"
        }
      };

      await messageQueue.sendMessage("payment_events", paymentEvent);

      // Store request and response for idempotency
      const response: PaymentResponse = { paymentId, status: "processing" };
      await requestsCollection.insertOne({
        idempotencyKey: req.idempotencyKey as string,
        response,
        createdAt: new Date()
      });

      res.status(202).json(response);
    } catch (error) {
      console.error("Payment error:", error);
      res.status(500).json({ error: "Payment processing failed" });
    }
  }
);

// Get all payments
app.get("/api/payments", async (req: Request, res: Response) => {
  try {
    const payments = await paymentsCollection.find().toArray();
    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// Get payment by ID
app.get("/api/payments/:id", (async (req: Request, res: Response) => {
  try {
    const payment = await paymentsCollection.findOne({
      paymentId: req.params.id
    });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({ error: "Failed to fetch payment" });
  }
}) as RequestHandler);

// Endpoint to view stored events (for development)
app.get("/api/events", async (req: Request, res: Response) => {
  try {
    const events = await eventsCollection.find().toArray();
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

async function getWiseQuote(
  sourceCurrency: string,
  targetCurrency: string,
  sourceAmount: number,
  targetAccount: number,
  profileId: number
): Promise<any> {
  try {
    const requestBody = {
      sourceCurrency: sourceCurrency,
      targetCurrency: targetCurrency,
      sourceAmount: sourceAmount,
      targetAmount: null,
      payOut: null,
      preferredPayIn: null,
      targetAccount: targetAccount,
      paymentMetadata: {
        transferNature: "USD_TO_INR_PAYOUT"
      }
    };

    const response = await fetch(
      `${WISE_API_URL}/v3/profiles/${profileId}/quotes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WISE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Wise API Response (Quote):", response.status, errorText);
      throw new Error(
        `Wise API Error (Quote): ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log("Quote received from Wise:", data);
    return data;
  } catch (error) {
    console.error("Error getting Wise quote:", error);
    throw error;
  }
}

// Mock Stripe API call - REPLACED by Wise Quote
// async function mockStripePayment(
//   amount: number,
//   currency: string,
//   customerId: string
// ): Promise<PaymentIntent> {
//   console.log(
//     `Creating payment of ${amount} ${currency} for customer ${customerId}`
//   );
//   return {
//     id: "pi_" + uuidv4().replace(/-/g, ""),
//     status: "succeeded",
//     amount,
//     currency
//   };
// }

// Connect to databases before starting the server
async function startServer() {
  const isMongoConnected = await connectToMongoDB();
  if (!isMongoConnected) {
    console.error("Failed to connect to MongoDB. Exiting...");
    process.exit(1);
  }

  // Connect to message queue (but don't fail if it's not available)
  await messageQueue.connect();

  app.listen(3001, () => {
    console.log("Payment service running on port 3001");
  });
}

startServer();
