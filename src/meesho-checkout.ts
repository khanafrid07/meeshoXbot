import axios from 'axios';
import fs from 'fs';

interface CheckoutInput {
    productId: number;
    variantId: number;
    addressId: number;
    destPin: string;
    cartSession: string;
}

export async function placeMeeshoApiOrder(input: CheckoutInput) {
    try {
        // 1. Load your exported session tokens from session.json
        if (!fs.existsSync('session.json')) {
            throw new Error("session.json file not found! Make sure your session tokens are saved.");
        }

        const sessionData = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
        const { xo, ox, authorization } = sessionData;

        // 2. Base domain we discovered from app traffic
        const baseUrl = 'https://prod.meeshoapi.com';

        // 3. Construct headers mirroring the official Android client
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'okhttp/4.9.0',
            'APP-CLIENT-ID': 'android',
            'APP-SDK-VERSION': '28',
            'Application-Id': 'com.meesho.supply',
            'Authorization': authorization || '',
            'Xo': xo || '',
            'X-Access-Token': ox || '',
            'MEESHO-USER-CONTEXT': 'logged_in'
        };

        // 4. Build the payload matching the CheckOutRequest structure we extracted from JADX
        const checkoutPayload = {
            context: "DEFAULT",
            identifier: "checkout_identifier_placeholder",
            cart_session: input.cartSession,
            dest_pin: input.destPin,
            address_id: input.addressId,
            payment_modes: ["ONLINE_PAID"],
            item: {
                product_id: input.productId,
                product_variant_id: input.variantId,
                quantity: 1
            },
            is_self_pickup: false
        };

        console.log("🚀 Sending direct checkout request to Meesho backend...");

        // 5. Fire the request directly to the payment/checkout load/update endpoints
        const response = await axios.post(
            `${baseUrl}/1.0/checkout/payment-page/load`,
            checkoutPayload,
            { headers }
        );

        console.log("✅ Checkout Response Received:", response.data);
        return { success: true, data: response.data };

    } catch (error: any) {
        console.error("❌ Checkout API Failed:", error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}