async function run() {
  try {
    const query = "What is the update in the privacy policy email from Anthropic?";
    console.log(`Sending query: "${query}"`);
    
    const response = await fetch('http://127.0.0.1:5000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: '0d3d9792-cfee-416d-991f-348aeac664ef',
        message: query,
        history: []
      })
    });
    
    const status = response.status;
    const data = await response.json();
    console.log('Response Status:', status);
    console.log('Response Answer:', data.answer);
    console.log('Citations/Sources found:', data.sources ? data.sources.length : 0);
    if (data.sources && data.sources.length > 0) {
      console.log('Sources details:', JSON.stringify(data.sources, null, 2));
    }
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

run();
