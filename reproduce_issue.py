import requests
import json

API_KEY = 'AIzaSyCLh3p3eujG63AYeazeZUmrOMaInLFcRJY'
URL = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}'

def test_gemini():
    prompt = "Analyze the following text from a webpage and provide ONLY a concise, descriptive title (max 10 words).\n    Do not include \"Title:\" prefix. Just the title text.\n\n    Text:\n    This is a test page content about machine learning and artificial intelligence."

    payload = {
        "contents": [{
            "parts": [{ "text": prompt }]
        }]
    }

    headers = {
        'Content-Type': 'application/json'
    }

    try:
        response = requests.post(URL, headers=headers, data=json.dumps(payload))
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("Response JSON:")
            print(json.dumps(data, indent=2))
            
            generated_text = data.get('candidates', [])[0].get('content', {}).get('parts', [])[0].get('text')
            print(f"\nGenerated Title: {generated_text}")
        else:
            print("Error Response:")
            print(response.text)

    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    test_gemini()
