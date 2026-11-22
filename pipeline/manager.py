from agent_planner import plan_module
from agent_researcher import research_topic
from agent_content import write_content, revise_content
from agent_design import build_module_deck
from agent_reviewer import review_content
from agent_visual_qa import visual_review

MAX_REVISION_ROUNDS = 2

topic = input("Enter topic: ").strip()

print("\nEnter 3-4 learning objectives, one per line. Press Enter on a blank line when done.")
objectives = []
while len(objectives) < 4:
    obj = input(f"  Objective {len(objectives) + 1}: ").strip()
    if not obj:
        break
    objectives.append(obj)

if len(objectives) < 1:
    print("At least one objective is required. Exiting.")
    raise SystemExit

print(f"\n=== Building Ticker Talks module: {topic} ===\n")

print("[Planner] Structuring the module...")
plan = plan_module(topic, objectives)

print("[Researcher] Gathering current clinical evidence...")
research = research_topic(topic, plan)

print("[Content] Writing case, teaching points, and quiz...")
content = write_content(topic, objectives, plan, research)

safe_name = topic.replace(" ", "_").replace("/", "_")
output_path = f"Ticker_Talks_{safe_name}.html"

round_num = 0
while True:
    print(f"\n[Design] Building slide deck (round {round_num + 1})...")
    build_module_deck(content, topic, output_path)

    print("[Reviewer] Checking content quality...")
    content_check = review_content(topic, objectives, content)

    print("[Reviewer] Checking visual layout...")
    visual_check = visual_review(output_path)

    issues = list(content_check.get("issues", []))
    for v_issue in visual_check.get("issues", []):
        issues.append(f"Slide {v_issue['slide_number']}: {v_issue['problem']}")

    if not issues:
        print("\nReview passed -- no issues found.")
        break

    print(f"\nReviewer found {len(issues)} issue(s):")
    for issue in issues:
        print(f"  - {issue}")

    if round_num >= MAX_REVISION_ROUNDS:
        print(f"\nReached max revision rounds ({MAX_REVISION_ROUNDS}). Using best available version.")
        print("Please review the flagged issues above manually.")
        break

    print("\n[Content] Revising based on feedback...")
    content = revise_content(topic, objectives, content, issues)
    round_num += 1

print(f"\nDone! Saved: {output_path}")
print("Remember: review clinical content before presenting to residents.")