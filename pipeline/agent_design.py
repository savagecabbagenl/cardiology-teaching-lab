import json
import html as html_lib


def esc(text):
    """HTML-escape any text pulled from generated content."""
    return html_lib.escape(str(text))


PULSE_ICON = """<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,12 7,12 10,4 14,20 17,12 23,12"/></svg>"""


def icon_header(title, light=False):
    """A consistent icon-in-circle + title, repeated across every slide as the visual motif."""
    circle_bg = "rgba(255,255,255,0.18)" if light else "#E8C7C9"
    icon_color = "#FCF6F5" if light else "#990011"
    return f"""
    <div class="header-row">
      <div class="icon-circle" style="background:{circle_bg}; color:{icon_color};">{PULSE_ICON}</div>
      <h2 class="section-title">{esc(title)}</h2>
    </div>
    """


def build_module_deck(content, topic, output_path, image_path=None, image_caption=None):
    v = content["case_vignette"]
    slides = []

    # ---- Slide: Title ----
    slides.append(f"""
    <section class="slide dark">
      <div class="title-block">
        <h1 class="title">Ticker Talks</h1>
        <div class="subtitle">{esc(content['title'])}</div>
      </div>
      <div class="footer-note">A 15-Minute Case-Based Cardiology Teaching Module</div>
    </section>
    """)

    # ---- Slide: Learning Objectives ----
    obj_rows = "".join(
        f"""<div class="obj-row"><div class="circle">{i}</div><div class="obj-text">{esc(o)}</div></div>"""
        for i, o in enumerate(content["learning_objectives"], start=1)
    )
    slides.append(f"""
    <section class="slide">
      {icon_header("Learning Objectives")}
      <div class="content-block">{obj_rows}</div>
    </section>
    """)

    # ---- Slide: Case Presentation (with patient snapshot if structured fields exist) ----
    snapshot_html = ""
    if v.get("age") or v.get("sex") or v.get("chief_complaint"):
        pills = []
        if v.get("age"):
            pills.append(f'<div class="stat-pill"><span class="stat-label">Age</span><span class="stat-value">{esc(v["age"])}</span></div>')
        if v.get("sex"):
            pills.append(f'<div class="stat-pill"><span class="stat-label">Sex</span><span class="stat-value">{esc(v["sex"])}</span></div>')
        if v.get("chief_complaint"):
            pills.append(f'<div class="stat-pill wide"><span class="stat-label">Chief Complaint</span><span class="stat-value">{esc(v["chief_complaint"])}</span></div>')
        snapshot_html = f'<div class="snapshot-row">{"".join(pills)}</div>'

    slides.append(f"""
    <section class="slide">
      {icon_header("Case Presentation")}
      <div class="content-block">
        {snapshot_html}
        <div class="field-label" style="margin-top:8px;">Presentation</div>
        <p class="field-text">{esc(v['presentation'])}</p>
        <div class="field-label" style="margin-top:28px;">History</div>
        <p class="field-text">{esc(v['history'])}</p>
      </div>
    </section>
    """)

    # ---- Slide: Exam & Workup (with optional image and key metric pills) ----
    image_html = ""
    if image_path:
        caption_html = f'<div class="image-caption">{esc(image_caption)}</div>' if image_caption else ""
        image_html = f"""
        <div class="image-wrap">
          <img src="{esc(image_path)}" class="case-image" alt="{esc(image_caption or 'Clinical image')}">
          {caption_html}
        </div>
        """

    metrics_html = ""
    key_metrics = content.get("key_metrics", [])
    if key_metrics:
        metric_pills = "".join(
            f'<div class="metric-pill"><span class="metric-value">{esc(m["value"])}</span><span class="metric-label">{esc(m["label"])}</span></div>'
            for m in key_metrics
        )
        metrics_html = f'<div class="metrics-row">{metric_pills}</div>'

    slides.append(f"""
    <section class="slide">
      {icon_header("Exam & Workup")}
      <div class="content-block">
        {metrics_html}
        <div class="two-col" style="margin-top: 0;">
          <div class="col-text">
            <div class="field-label">Physical Exam</div>
            <p class="field-text">{esc(v['exam_findings'])}</p>
            <div class="field-label" style="margin-top:24px;">Workup</div>
            <p class="field-text">{esc(v['workup_results'])}</p>
          </div>
          <div class="col-visual">{image_html}</div>
        </div>
      </div>
    </section>
    """)

    # ---- Slide(s): Teaching Points ----
    cards = "".join(
        f"""<div class="card"><h3>{esc(tp['heading'])}</h3><p>{esc(tp['explanation'])}</p></div>"""
        for tp in content["teaching_points"]
    )
    slides.append(f"""
    <section class="slide">
      {icon_header("Teaching Points")}
      <div class="content-block">{cards}</div>
    </section>
    """)

    # ---- Slide: Discussion Questions ----
    dq_items = "".join(f"<li>{esc(q)}</li>" for q in content["discussion_questions"])
    slides.append(f"""
    <section class="slide navy">
      {icon_header("Discussion Questions", light=True)}
      <div class="content-block">
        <ul class="discussion-list">{dq_items}</ul>
      </div>
    </section>
    """)

    # ---- Quiz slides: interactive, click to reveal ----
    letters = ["A", "B", "C", "D"]
    for qi, q in enumerate(content["quiz"]):
        options_html = ""
        for oi, opt in enumerate(q["options"]):
            options_html += f"""
            <div class="quiz-option" data-qi="{qi}" data-oi="{oi}"
                 onclick="checkAnswer({qi}, {oi}, {q['correct_index']})">
              <div class="opt-letter">{letters[oi]}</div>
              <div class="opt-text">{esc(opt)}</div>
            </div>
            """
        slides.append(f"""
        <section class="slide">
          {icon_header(f"Quiz — Question {qi + 1}")}
          <div class="content-block">
            <p class="quiz-question">{esc(q['question'])}</p>
            <div class="quiz-options" id="quiz-{qi}">{options_html}</div>
            <div class="quiz-explain" id="explain-{qi}">{esc(q['explanation'])}</div>
          </div>
        </section>
        """)

    # ---- Slide: Sources ----
    src_items = "".join(f"<li>{esc(s)}</li>" for s in content["sources"])
    slides.append(f"""
    <section class="slide dark">
      {icon_header("Sources", light=True)}
      <div class="content-block">
        <ul class="source-list">{src_items}</ul>
      </div>
    </section>
    """)

    slides_html = "\n".join(slides)
    num_slides = len(slides)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ticker Talks: {esc(content['title'])}</title>
<style>
  :root {{
    --cherry: #990011;
    --off-white: #FCF6F5;
    --navy: #2F3C7E;
    --dark-text: #222222;
    --muted: #6B6B6B;
    --card-bg: #F7ECEB;
    --card-bg-hover: #F0DCDA;
    --correct: #DCF3DC;
    --incorrect: #FBDADA;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0; padding: 0; height: 100%;
    font-family: Calibri, 'Segoe UI', Arial, sans-serif;
    background: #111;
    color: var(--dark-text);
  }}
  .slide {{
    width: 100vw; height: 100vh;
    display: none;
    flex-direction: column;
    justify-content: center;
    padding: 70px 100px;
    background: var(--off-white);
    overflow-y: auto;
  }}
  .slide.active {{ display: flex; }}
  .slide.dark {{ background: var(--cherry); color: var(--off-white); }}
  .slide.navy {{ background: var(--navy); color: var(--off-white); }}

  .title-block {{ margin-bottom: 20px; }}
  h1.title {{ font-family: Cambria, Georgia, serif; font-size: 56px; margin: 0 0 12px; }}
  .subtitle {{ font-size: 24px; }}
  .footer-note {{ font-size: 14px; font-style: italic; margin-top: auto; opacity: 0.85; }}

  h2.section-title {{
    font-family: Cambria, Georgia, serif; font-size: 34px;
    color: var(--cherry); margin: 0; flex-shrink: 0;
  }}
  .slide.dark h2.section-title, .slide.navy h2.section-title {{ color: var(--off-white); }}

  .header-row {{ display: flex; align-items: center; gap: 18px; margin-bottom: 30px; flex-shrink: 0; }}
  .icon-circle {{
    flex-shrink: 0; width: 48px; height: 48px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }}

  .snapshot-row {{ display: flex; gap: 14px; margin-bottom: 26px; flex-wrap: wrap; }}
  .stat-pill {{
    background: var(--card-bg); border-radius: 10px;
    padding: 12px 20px; display: flex; flex-direction: column; gap: 3px;
  }}
  .stat-pill.wide {{ flex: 1; min-width: 260px; }}
  .stat-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: bold; }}
  .stat-value {{ font-size: 18px; font-weight: bold; color: var(--dark-text); }}

  .metrics-row {{ display: flex; gap: 16px; margin-bottom: 26px; flex-wrap: wrap; }}
  .metric-pill {{
    background: var(--navy); color: var(--off-white); border-radius: 12px;
    padding: 14px 22px; display: flex; flex-direction: column; align-items: center; gap: 4px;
    min-width: 130px;
  }}
  .metric-value {{ font-size: 24px; font-weight: bold; font-family: Cambria, Georgia, serif; }}
  .metric-label {{ font-size: 12px; opacity: 0.85; text-align: center; }}

  .content-block {{ flex: 1; min-height: 0; overflow-y: auto; }}

  .obj-row {{ display: flex; align-items: center; gap: 22px; margin-bottom: 26px; }}
  .circle {{
    flex-shrink: 0; width: 46px; height: 46px; border-radius: 50%;
    background: #E8C7C9; color: var(--cherry);
    display: flex; align-items: center; justify-content: center;
    font-weight: bold; font-size: 19px;
  }}
  .obj-text {{ font-size: 18px; line-height: 1.4; }}

  .field-label {{ font-weight: bold; color: var(--cherry); font-size: 17px; margin-bottom: 8px; }}
  .field-text {{ font-size: 16px; line-height: 1.6; margin: 0; }}

  .two-col {{ display: flex; gap: 50px; align-items: flex-start; }}
  .col-text {{ flex: 1.3; }}
  .col-visual {{ flex: 1; display: flex; align-items: center; justify-content: center; }}
  .image-wrap {{ text-align: center; }}
  img.case-image {{ max-width: 100%; max-height: 320px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.12); }}
  .image-caption {{ font-size: 13px; color: var(--muted); font-style: italic; margin-top: 10px; }}

  .card {{ background: var(--card-bg); border-radius: 10px; padding: 18px 26px; margin-bottom: 16px; }}
  .card h3 {{ color: var(--cherry); margin: 0 0 8px; font-size: 18px; }}
  .card p {{ margin: 0; font-size: 16px; line-height: 1.6; }}

  .discussion-list {{ font-size: 21px; line-height: 1.8; padding-left: 28px; }}
  .discussion-list li {{ margin-bottom: 20px; }}

  .quiz-question {{ font-size: 20px; font-weight: bold; margin: 0 0 30px; }}
  .quiz-options {{ display: flex; flex-direction: column; gap: 14px; }}
  .quiz-option {{
    display: flex; align-items: center; gap: 18px;
    padding: 16px 22px; border-radius: 10px;
    background: var(--card-bg); cursor: pointer;
    transition: background 0.15s ease;
  }}
  .quiz-option:hover {{ background: var(--card-bg-hover); }}
  .quiz-option.correct {{ background: var(--correct); }}
  .quiz-option.incorrect {{ background: var(--incorrect); }}
  .opt-letter {{
    flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
    background: #E8C7C9; color: var(--cherry);
    display: flex; align-items: center; justify-content: center;
    font-weight: bold; font-size: 15px;
  }}
  .quiz-option.correct .opt-letter {{ background: #8FD18F; color: #1a4d1a; }}
  .quiz-option.incorrect .opt-letter {{ background: #E89A9A; color: #6b1a1a; }}
  .opt-text {{ font-size: 17px; }}
  .quiz-explain {{
    display: none; margin-top: 26px; padding: 18px 24px;
    background: var(--card-bg); border-radius: 10px; font-size: 16px; line-height: 1.55;
  }}

  .source-list {{ font-size: 16px; line-height: 2; padding-left: 26px; }}

  .progress {{
    position: fixed; bottom: 22px; right: 34px;
    font-size: 13px; color: var(--muted); z-index: 10;
  }}
  .slide.dark .progress, .slide.navy .progress {{ color: rgba(255,255,255,0.8); }}
  .nav-hint {{
    position: fixed; bottom: 22px; left: 34px;
    font-size: 12px; color: var(--muted); z-index: 10;
  }}
</style>
</head>
<body>

{slides_html}

<div class="progress" id="progress">1 / {num_slides}</div>
<div class="nav-hint">Use &larr; &rarr; arrow keys to navigate</div>

<script>
  const slides = document.querySelectorAll('.slide');
  let current = 0;

  function show(i) {{
    slides[current].classList.remove('active');
    current = (i + slides.length) % slides.length;
    slides[current].classList.add('active');
    document.getElementById('progress').textContent = (current + 1) + ' / ' + slides.length;
  }}

  document.addEventListener('keydown', function(e) {{
    if (e.key === 'ArrowRight' || e.key === ' ') {{ show(current + 1); e.preventDefault(); }}
    if (e.key === 'ArrowLeft') {{ show(current - 1); e.preventDefault(); }}
  }});

  function checkAnswer(qIndex, selectedIndex, correctIndex) {{
    const options = document.querySelectorAll('#quiz-' + qIndex + ' .quiz-option');
    options.forEach(function(opt, i) {{
      opt.classList.remove('correct', 'incorrect');
      if (i === correctIndex) opt.classList.add('correct');
      else if (i === selectedIndex) opt.classList.add('incorrect');
    }});
    document.getElementById('explain-' + qIndex).style.display = 'block';
  }}

  show(0);
</script>

</body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(page)


if __name__ == "__main__":
    from agent_planner import plan_module
    from agent_researcher import research_topic
    from agent_content import write_content

    topic = "Aortic Stenosis"
    objectives = ["Recognize severe AS on exam", "Interpret echo severity criteria", "Know when to refer for intervention"]

    plan = plan_module(topic, objectives)
    research = research_topic(topic, plan)
    content = write_content(topic, objectives, plan, research)

    build_module_deck(content, topic, "Ticker_Talks_Aortic_Stenosis.html")
    print("Saved HTML deck")