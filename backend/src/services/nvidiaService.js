import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.warn('Warning: NVIDIA_API_KEY is missing from environment.');
}

const openai = new OpenAI({
  apiKey: apiKey || 'dummy-key',
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

// Categorize email using Llama-3.1-8b-instruct on NVIDIA NIM
export async function categorizeEmail({ subject, snippet, from_name, from_address }) {
  if (!apiKey) {
    // Fallback if key is missing
    console.warn('NVIDIA API key missing, defaulting to Work / Professional category');
    return 'Work / Professional';
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [
        {
          role: 'system',
          content: `You are an expert email classifier. Categorize the given email into exactly ONE of the following categories:
- Newsletters (subscription digests, mailing lists, newsletters, product updates, tech blogs)
- Job / Recruitment (resume applications, interviewer scheduling, offers, rejections, recruitment headhunters)
- Finance (bank alerts, credit card transaction OTPs, invoices, receipts, subscription bills, payments)
- Notifications (SaaS alerts, login notifications, GitHub notifications, platform alerts, non-financial OTPs)
- Personal (direct human-to-human personal emails, family, friends)
- Work / Professional (business updates, company projects, team communications, office syncs, customer support/sales enquiries)

Return ONLY the name of the category. Do not output markdown, punctuation, explanations, or any other text.`
        },
        {
          role: 'user',
          content: `Subject: ${subject || 'No Subject'}
Sender: ${from_name || ''} <${from_address || ''}>
Snippet: ${snippet || ''}

Category:`
        }
      ],
      temperature: 0.1,
      max_tokens: 15
    });

    const category = response.choices[0].message.content.trim();
    const allowedCategories = [
      'Newsletters',
      'Job / Recruitment',
      'Finance',
      'Notifications',
      'Personal',
      'Work / Professional'
    ];

    if (allowedCategories.includes(category)) {
      return category;
    }
    
    // Fuzzy matching if LLM returns trailing characters
    for (const allowed of allowedCategories) {
      if (category.toLowerCase().includes(allowed.toLowerCase())) {
        return allowed;
      }
    }
    
    return 'Work / Professional'; // Default fallback
  } catch (err) {
    console.error('Error categorizing email with NVIDIA NIM:', err.message);
    return 'Work / Professional'; // Fallback on network/model error
  }
}

// Extract and deduplicate newsletter items semantically
export async function deduplicateNewsletters(emails) {
  if (!emails || emails.length === 0) {
    return [];
  }
  
  if (!apiKey) {
    console.warn('NVIDIA API key missing, cannot run newsletter deduplication');
    return [];
  }

  try {
    const formattedEmails = emails.map((e, idx) => `
Newsletter [${idx + 1}]
Source: ${e.from_name || e.from_address} (Subject: ${e.subject})
Date: ${new Date(e.date).toLocaleDateString()}
Content: ${e.body_text ? e.body_text.substring(0, 3000) : e.snippet}
---`).join('\n');

    const prompt = `You are a professional news analyst. I will provide you with several newsletter emails. 
Perform the following tasks:
1. Scan the newsletters and extract the main news stories, updates, or articles mentioned in them.
2. Identify stories that are semantically identical or discuss the exact same news event (even if they use different wording or titles).
3. Deduplicate these stories, creating a single synthesized entry for each unique story.
4. For each unique story, provide:
   - "title": A clear, engaging headline.
   - "summary": A brief 2-3 sentence description of the story synthesized from the sources.
   - "sources": An array of strings citing which newsletters/senders this story was extracted from.
   - "category": A category for this news item (e.g., Tech, Finance, AI, Business).

Return ONLY a raw JSON array of these objects. Do not wrap the JSON in markdown code blocks.
Example output format:
[
  {
    "title": "NVIDIA Releases New AI Model",
    "summary": "NVIDIA has launched its latest AI model Nemotron. It boasts higher benchmarks and is open source.",
    "sources": ["TLDR Newsletter", "Superhuman AI"],
    "category": "AI"
  }
]

Newsletters:
${formattedEmails.substring(0, 15000)}`;

    const response = await openai.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2
    });

    const textResponse = response.choices[0].message.content.trim();
    try {
      const cleanJson = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.error('Failed to parse deduplicated newsletter JSON. Response content was:', textResponse);
      return [];
    }
  } catch (err) {
    console.error('Error during newsletter deduplication:', err.message);
    return [];
  }
}
