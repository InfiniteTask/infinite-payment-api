// Types used throughout the application
export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
}

export interface PaymentResponse {
  paymentId: string;
  status: string;
}

export interface PaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface PaymentEvent {
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

export interface IdempotentRequest extends Request {
  idempotencyKey?: string;
}

export interface StoredRequest {
  idempotencyKey: string;
  response: PaymentResponse;
  createdAt: Date;
}

export interface StoredEvent {
  queue: string;
  message: any;
  createdAt: Date;
  processed?: boolean;
}

export interface RecipientRequest {
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

// Add import for Request from express
import { Request } from "express";
