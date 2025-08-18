import fetch from "node-fetch";

const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"; // from Supabase settings
const USER_ID = "test-user-id"; // dummy test
const QUOTE_NUM = `QUOTE-${Date.now()}`;

// Dummy AI payload
const aiPayload = {
  user_id: USER_ID,
  description: "Refit a small bathroom including strip out, plumbing, tiling, and installation",
  address: "10 Downing Street, London",
  rate_per_hour: 45,
  hours_per_day: 8
};

// Helper to call Supabase function directly
async function callFunction(name, body) {
  console.log(`--- Calling ${name} ---`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Raw response:", text);

  try {
    const json = JSON.parse(text);
    console.log("JSON:", json);
  } catch {
    console.log("⚠ Response was not valid JSON");
  }
}

(async () => {
  // 1️⃣ Call AI generator first
  await callFunction("ai-generate-quote", aiPayload);

  // 2️⃣ Call PDF builder with a minimal payload
  await callFunction("pdf-builder", {
    user_id: USER_ID,
    branding: { business_name: "Test Co" },
    quote: {
      quote_number: QUOTE_NUM,
      client_name: "Test Client",
      line_items: [
        { description: "Labour", qty: 1, unit_price: 100, total: 100 },
        { description: "Materials", qty: 1, unit_price: 50, total: 50 }
      ],
      totals: { subtotal: 150, vat_rate: 0.2, vat_amount: 30, total: 180 }
    }
  });
})();