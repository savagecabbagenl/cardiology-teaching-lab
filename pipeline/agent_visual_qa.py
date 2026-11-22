import os
import base64
from playwright.sync_api import sync_playwright
import anthropic
from json_utils import parse_json

client = anthropic.Anthropic()


def render_deck_to_images(html_path, output_dir):
    """Opens the HTML deck in a headless browser and screenshots every slide."""
    html_path = os.path.abspath(html_path)
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    image_paths = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(f"file://{html_path}")

        num_slides = page.evaluate("document.querySelectorAll('.slide').length")

        for i in range(num_slides):
            path = os.path.join(output_dir, f"slide-{i + 1:02d}.png")
            page.screenshot(path=path)
            image_paths.append(path)
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(100)

        browser.close()

    return image_paths


def image_to_base64(path):
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def visual_review(html_path):
    image_dir = html_path.replace(".html", "_slide_images")
    image_paths = render_deck_to_images(html_path, image_dir)

    content_blocks = []
    for i, img_path in enumerate(image_paths, start=1):
        content_blocks.append({"type": "text", "text": f"Slide {i}:"})
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": image_to_base64(img_path)
            }
        })

    content_blocks.append({
        "type": "text",
        "text": """You are doing visual QA on an HTML teaching slide deck. Look at every
slide image above and check for: text cut off or overflowing past a card or slide
edge, overlapping elements, text touching or crossing slide boundaries, low-contrast
text, or anything that looks visually broken or unprofessional.

Respond with ONLY valid JSON, no other text, in exactly this structure:
{
  "passed": true or false,
  "issues": [
    {"slide_number": 1, "problem": "description of the issue"}
  ]
}

If nothing is wrong, return passed: true with an empty issues list.
"""
    })

    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": content_blocks}]
    )
    return parse_json(response.content[0].text)


if __name__ == "__main__":
    import json
    result = visual_review("Ticker_Talks_Aortic_Stenosis.html")
    print(json.dumps(result, indent=2))