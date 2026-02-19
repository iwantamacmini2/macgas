/**
 * x402 Payment Middleware for MacGas
 * 
 * Enables automatic payment for gasless transaction sponsorship.
 * When balance is insufficient, returns 402 with Solana USDC payment option.
 */

import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactSvmScheme } from '@x402/svm/exact/server';

// Our receiving wallet
const PAY_TO = 'F6i99DWMEMZtLDKnWGx1FW6drkqvtDnXWLHxgrwzVdWD';

// Solana mainnet CAIP-2 identifier
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// Cost per transaction in USD
const COST_PER_TX_USD = 0.001; // $0.001 per tx

// Facilitator URL (use x402.org for now, could self-host later)
const FACILITATOR_URL = 'https://x402.org/facilitator';

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL
});

// Create resource server and register Solana scheme
const x402Server = new x402ResourceServer(facilitatorClient);
const svmScheme = new ExactSvmScheme();
x402Server.register(SOLANA_MAINNET, svmScheme);

/**
 * Create x402 payment requirements for topping up balance
 * @param {number} txCount - Number of transactions to fund
 * @returns {Object} Payment requirements object
 */
export function createPaymentRequirements(txCount = 100) {
  const price = (txCount * COST_PER_TX_USD).toFixed(4);
  
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: SOLANA_MAINNET,
        price: `$${price}`,
        payTo: PAY_TO,
        asset: {
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          decimals: 6,
          symbol: 'USDC'
        },
        extra: {
          description: `Fund ${txCount} gasless transactions on macgas.xyz`
        }
      }
    ],
    description: `Fund gasless transactions ($${COST_PER_TX_USD}/tx)`,
    mimeType: 'application/json'
  };
}

/**
 * Build 402 Payment Required response
 * @param {number} txCount - Number of transactions to fund
 * @returns {Object} Response object with headers and body
 */
export function build402Response(txCount = 100) {
  const requirements = createPaymentRequirements(txCount);
  const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');
  
  return {
    status: 402,
    headers: {
      'X-Payment-Required': encoded,
      'Content-Type': 'application/json'
    },
    body: {
      error: 'Payment Required',
      message: 'Insufficient balance for gasless transaction',
      x402: {
        ...requirements,
        instructions: [
          'Your x402-compatible client should automatically handle this payment.',
          'Or manually send USDC to ' + PAY_TO + ' with your project ID as memo.',
          'Docs: https://macgas.xyz/SKILL.md'
        ]
      }
    }
  };
}

/**
 * Verify and process x402 payment
 * @param {string} paymentHeader - Base64 encoded payment payload from X-Payment header
 * @param {Object} requirements - The payment requirements that were sent
 * @returns {Promise<Object>} Verification result
 */
export async function verifyPayment(paymentHeader, requirements) {
  try {
    const payload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    
    // Verify with facilitator
    const verification = await x402Server.verify(payload, requirements);
    
    if (!verification.valid) {
      return { valid: false, error: verification.error || 'Invalid payment' };
    }
    
    // Settle the payment
    const settlement = await x402Server.settle(payload, requirements);
    
    if (!settlement.success) {
      return { valid: false, error: settlement.error || 'Settlement failed' };
    }
    
    return {
      valid: true,
      amount: payload.amount,
      txSignature: settlement.transactionHash,
      txCount: Math.floor(parseFloat(requirements.accepts[0].price.replace('$', '')) / COST_PER_TX_USD)
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Express middleware for x402 support
 * Checks for payment header and processes payment before continuing
 */
export function x402Middleware(getBalance, creditBalance) {
  return async (req, res, next) => {
    const projectId = req.headers['x-project-id'];
    
    // Check for x402 payment header
    const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
    
    if (paymentHeader) {
      // Process the payment
      const txCount = 100; // Default funding amount
      const requirements = createPaymentRequirements(txCount);
      
      const result = await verifyPayment(paymentHeader, requirements);
      
      if (result.valid) {
        // Credit the balance
        await creditBalance(projectId, result.txCount);
        
        // Add payment info to request for logging
        req.x402Payment = result;
        
        // Continue with the original request
        return next();
      } else {
        return res.status(402).json({
          error: 'Payment verification failed',
          details: result.error
        });
      }
    }
    
    // No payment header - check if balance is sufficient
    const balance = await getBalance(projectId);
    
    if (balance <= 0) {
      // Return 402 with payment requirements
      const response = build402Response(100);
      res.set(response.headers);
      return res.status(response.status).json(response.body);
    }
    
    // Balance is sufficient, continue
    next();
  };
}

export { x402Server, SOLANA_MAINNET, PAY_TO, COST_PER_TX_USD };
