async function run() {
  try {
    console.log('Sending test POST /api/chat request to 127.0.0.1:5000...');
    const response = await fetch('http://127.0.0.1:5000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: '0d3d9792-cfee-416d-991f-348aeac664ef',
        message: 'Tell me about the security alerts in my mailbox',
        history: []
      })
    });
    
    const status = response.status;
    const data = await response.json();
    console.log('Response Status:', status);
    console.log('Response Data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

run();
