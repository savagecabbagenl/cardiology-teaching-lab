import anthropic
from json_utils import parse_json

client = anthropic.Anthropic()


def research_topic(topic, plan):
    teaching_points_text = "\n".join(f"- {tp}" for tp in plan["teaching_points"])

    prompt = f"""You are a clinical researcher supporting the creation of a cardiology
teaching case on: {topic}

The case needs to cover these teaching points:
{teaching_points_text}

Search for current, authoritative clinical information: current guideline
recommendations (e.g. ACC/AHA/ESC), key landmark trial data, and standard diagnostic
criteria relevant to this topic.

After researching, respond with ONLY valid JSON, no other text, in exactly this
structure:
{{
  "guideline_summary": "2-3 sentence summary of current guideline recommendations",
  "key_trials_or_evidence": ["...", "..."],
  "diagnostic_criteria": "relevant diagnostic thresholds or criteria",
  "sources": ["source name or citation", "..."]
}}
"""
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
        messages=[{"role": "user", "content": prompt}]
    )

    # A web-search-enabled response can include multiple content blocks
    # (search calls, search results, text). We only want the text Claude
    # wrote, which should be our final JSON.
    text_parts = [block.text for block in response.content if block.type == "text"]
    full_text = "\n".join(text_parts)
    return parse_json(full_text)


if __name__ == "__main__":
    import json
    from agent_planner import plan_module
    plan = plan_module(
        "Aortic Stenosis",
        ["Recognize severe AS on exam", "Interpret echo severity criteria", "Know when to refer for intervention"]
    )
    research = research_topic("Aortic Stenosis", plan)
    print(json.dumps(research, indent=2))