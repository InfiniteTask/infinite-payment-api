import fetch from "node-fetch";
import { config } from "../config";

const { apiKey, apiUrl, profileId } = config.wise;

export async function getWiseQuote(
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

    const response = await fetch(`${apiUrl}/v3/profiles/${profileId}/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

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

export async function fetchAccountDetails(): Promise<any> {
  try {
    const response = await fetch(
      `${apiUrl}/v1/profiles/${profileId}/account-details`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Wise API Error (Account Details): ${response.status} ${response.statusText}`
      );
    }

    const accountDetailsData = await response.json();
    console.log(accountDetailsData, "account details data");
    return accountDetailsData;
  } catch (error) {
    console.error("Error fetching account details:", error);
    throw error;
  }
}

export async function fetchRecipients(): Promise<any> {
  try {
    const response = await fetch(
      `${apiUrl}/v2/accounts?profile=${profileId}&currency=INR`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Wise API Error (Recipients): ${response.status} ${response.statusText}`
      );
    }

    const recipientsData = await response.json();
    console.log(recipientsData, "recipients data");
    return recipientsData;
  } catch (error) {
    console.error("Error fetching recipients:", error);
    throw error;
  }
}
