import os
import asyncio
import random
import json
import io
import base64
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import discord
from discord.ext import commands
from discord.ui import View, Button, Select, Modal, TextInput
from discord import Interaction, Embed, Color, File, ButtonStyle, SelectOption

from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from PIL import Image, ImageDraw, ImageFont
import google.generativeai as genai
from supabase import create_client, Client

# ====================== CONFIG ======================
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
MAIN_CHANNEL_ID = int(os.getenv("MAIN_CHANNEL_ID", "0"))
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-3.8-flash")   # Free tier + strongest available Flash
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Active browser sessions keyed by discord user id
active_sessions: Dict[int, Dict[str, Any]] = {}

# ====================== QUEUE SYSTEM ======================
async def get_queue_status(platform: str = "sparx") -> Dict[str, Any]:
    res = supabase.table("queue").select("*").eq("platform", platform).execute()
    data = res.data or []
    active = [r for r in data if r.get("status") == "active"]
    waiting = [r for r in data if r.get("status") == "waiting"]
    return {
        "active": len(active),
        "waiting": len(waiting),
        "active_user": active[0]["user_id"] if active else None,
        "waiting_users": [r["user_id"] for r in waiting]
    }

async def join_queue(user_id: int, platform: str = "sparx") -> str:
    status = await get_queue_status(platform)
    if status["active"] >= 1:
        supabase.table("queue").upsert({
            "user_id": user_id,
            "platform": platform,
            "status": "waiting",
            "joined_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        return "waiting"
    supabase.table("queue").upsert({
        "user_id": user_id,
        "platform": platform,
        "status": "active",
        "joined_at": datetime.now(timezone.utc).isoformat()
    }).execute()
    return "active"

async def leave_queue(user_id: int, platform: str = "sparx"):
    try:
        supabase.table("queue").delete().eq("user_id", user_id).eq("platform", platform).execute()
    except Exception:
        pass

async def promote_next(platform: str = "sparx") -> Optional[int]:
    status = await get_queue_status(platform)
    if status["active"] == 0 and status["waiting"] > 0:
        res = supabase.table("queue").select("*").eq("platform", platform).eq("status", "waiting").order("joined_at").limit(1).execute()
        if res.data:
            next_user = res.data[0]
            supabase.table("queue").update({"status": "active"}).eq("user_id", next_user["user_id"]).execute()
            return next_user["user_id"]
    return None

# ====================== PNG PROGRESS CARD ======================
def create_progress_png(percent: int, current: str, completed: str, elapsed: str) -> io.BytesIO:
    width, height = 620, 240
    img = Image.new("RGB", (width, height), "#0B1120")
    draw = ImageDraw.Draw(img)

    # Title
    draw.text((28, 22), "Rise Ai  •  Sparx Maths", fill="#E2E8F0")

    # Progress bar background
    bar_x, bar_y, bar_w, bar_h = 28, 70, 560, 32
    draw.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], radius=16, fill="#1E293B")

    # Fill
    fill_w = max(0, min(bar_w, int(bar_w * (percent / 100))))
    if fill_w > 8:
        draw.rounded_rectangle([bar_x, bar_y, bar_x + fill_w, bar_y + bar_h], radius=16, fill="#3B82F6")

    # Percentage
    draw.text((28, 118), f"{percent}%", fill="#93C5FD")

    # Stats
    draw.text((28, 155), f"Current: {current}", fill="#94A3B8")
    draw.text((28, 185), f"Completed: {completed}", fill="#94A3B8")
    draw.text((340, 185), f"Time: {elapsed}", fill="#94A3B8")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf

# ====================== PLAYWRIGHT + STEALTH ======================
async def create_stealth_context(playwright) -> BrowserContext:
    browser = await playwright.chromium.launch(
        headless=HEADLESS,
        channel="chrome",  # real Chrome preferred
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-infobars",
            "--window-size=1920,1080",
        ]
    )

    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        locale="en-GB",
        timezone_id="Europe/London",
        color_scheme="dark",
    )

    # Stealth init script
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
    """)

    return context

async def wait_for_cloudflare(page: Page, timeout: int = 30000):
    """Wait for Cloudflare challenge to clear"""
    try:
        await page.wait_for_function("""
            () => {
                const title = document.title.toLowerCase();
                return !title.includes('just a moment') &&
                       !title.includes('attention required') &&
                       !title.includes('cloudflare') &&
                       !document.querySelector('#challenge-form') &&
                       !document.querySelector('.cf-browser-verification');
            }
        """, timeout=timeout)
    except Exception:
        pass

# ====================== GEMINI SOLVER ======================
async def solve_question(question_text: str, image_b64: Optional[str] = None) -> str:
    prompt = f"""You are solving a Sparx Maths question.
Return ONLY the final answer. No explanation, no working, no extra text.

Question:
{question_text}
"""
    try:
        if image_b64:
            image_part = {
                "mime_type": "image/png",
                "data": base64.b64decode(image_b64)
            }
            response = model.generate_content([prompt, image_part])
        else:
            response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Gemini error: {e}")
        return ""

# ====================== SPARX CORE ======================
async def sparx_login(page: Page, username: str, password: str) -> bool:
    try:
        await page.goto("https://maths.sparx-learning.com/", wait_until="domcontentloaded")
        await wait_for_cloudflare(page)

        await page.wait_for_selector('input[type="text"], input[name="username"], input[placeholder*="Username"]', timeout=15000)

        user_input = await page.query_selector('input[type="text"], input[name="username"]')
        pass_input = await page.query_selector('input[type="password"]')

        if user_input and pass_input:
            await user_input.fill(username)
            await pass_input.fill(password)
            await page.keyboard.press("Enter")
            await page.wait_for_load_state("networkidle")
            await wait_for_cloudflare(page)
            return True
        return False
    except Exception as e:
        print(f"Login error: {e}")
        return False

async def get_homework_list(page: Page) -> List[Dict[str, Any]]:
    """Return list of available packages/tasks – expand with real selectors later"""
    try:
        await page.goto("https://maths.sparx-learning.com/student/", wait_until="networkidle")
        await asyncio.sleep(2)
        return [{"id": "demo", "name": "Current Homework", "due": "Soon"}]
    except Exception:
        return []

# ====================== DISCORD UI ======================
class TimeSettingsModal(Modal, title="Answer Delay Settings"):
    min_delay = TextInput(label="Minimum seconds between answers", placeholder="e.g. 8", required=True)
    max_delay = TextInput(label="Maximum seconds between answers", placeholder="e.g. 25", required=True)

    def __init__(self, user_id: int):
        super().__init__()
        self.user_id = user_id

    async def on_submit(self, interaction: Interaction):
        try:
            min_s = max(3, int(self.min_delay.value))
            max_s = max(min_s + 1, int(self.max_delay.value))
        except ValueError:
            await interaction.response.send_message("Please enter valid numbers.", ephemeral=True)
            return

        if self.user_id in active_sessions:
            active_sessions[self.user_id]["min_delay"] = min_s
            active_sessions[self.user_id]["max_delay"] = max_s

        await interaction.response.send_message(
            f"Delay set to {min_s}–{max_s} seconds. Starting solver...",
            ephemeral=True
        )
        asyncio.create_task(run_solver(self.user_id, interaction.user))

class LoginModal(Modal, title="Sparx Login"):
    username = TextInput(label="Username / Email", required=True)
    password = TextInput(label="Password", required=True)

    def __init__(self, user_id: int):
        super().__init__()
        self.user_id = user_id

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)

        active_sessions[self.user_id] = {
            "username": self.username.value,
            "password": self.password.value,
            "platform": "sparx",
            "min_delay": 8,
            "max_delay": 20,
            "cancelled": False
        }

        await interaction.followup.send(
            "Credentials received. Click below to set delay and start:",
            view=ConfirmStartView(self.user_id),
            ephemeral=True
        )

class ConfirmStartView(View):
    def __init__(self, user_id: int):
        super().__init__(timeout=120)
        self.user_id = user_id

    @discord.ui.button(label="Set Delay & Start", style=ButtonStyle.primary)
    async def start(self, interaction: Interaction, button: Button):
        if interaction.user.id != self.user_id:
            return
        modal = TimeSettingsModal(self.user_id)
        await interaction.response.send_modal(modal)

class PlatformSelect(Select):
    def __init__(self, mode: str = "start"):
        options = [
            SelectOption(label="Sparx Maths", value="sparx", description="Complete Sparx homework")
        ]
        super().__init__(placeholder="Choose a platform...", options=options)
        self.mode = mode

    async def callback(self, interaction: Interaction):
        platform = self.values[0]

        if self.mode == "queue":
            status = await get_queue_status(platform)
            embed = Embed(title="Sparx Maths Queue", color=Color.dark_blue())
            embed.description = (
                f"• People using the autocompleter: **{status['active']}**\n"
                f"• People in queue: **{status['waiting']}**\n"
                f"• You are {'**in the queue**' if interaction.user.id in status['waiting_users'] or status['active_user'] == interaction.user.id else '**not in queue**'}"
            )
            embed.set_footer(text="Max concurrent: 1")
            await interaction.response.edit_message(embed=embed, view=None)
            return

        # Start Task flow
        result = await join_queue(interaction.user.id, platform)
        if result == "waiting":
            await interaction.response.send_message(
                "Someone is already using the autocompleter.\nYou have been added to the queue.",
                ephemeral=True
            )
        else:
            # FIX: Send modal directly as the response, not via followup
            modal = LoginModal(interaction.user.id)
            await interaction.response.send_modal(modal)

class QueueView(View):
    def __init__(self):
        super().__init__(timeout=120)
        self.add_item(PlatformSelect(mode="queue"))

class StartView(View):
    def __init__(self):
        super().__init__(timeout=120)
        self.add_item(PlatformSelect(mode="start"))

class MainView(View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Start Task", style=ButtonStyle.primary, custom_id="rise:start_task")
    async def start_task(self, interaction: Interaction, button: Button):
        embed = Embed(
            title="Choose Platform",
            description="Select the platform you want to complete homework on.",
            color=Color.dark_blue()
        )
        await interaction.response.send_message(embed=embed, view=StartView(), ephemeral=True)

    @discord.ui.button(label="View Queue", style=ButtonStyle.secondary, custom_id="rise:view_queue")
    async def view_queue(self, interaction: Interaction, button: Button):
        embed = Embed(
            title="View Queue",
            description="Select a platform to see the current queue status.",
            color=Color.dark_blue()
        )
        await interaction.response.send_message(embed=embed, view=QueueView(), ephemeral=True)

class CancelView(View):
    def __init__(self, user_id: int):
        super().__init__(timeout=None)
        self.user_id = user_id

    @discord.ui.button(label="Cancel Task", style=ButtonStyle.danger, custom_id="rise:cancel")
    async def cancel(self, interaction: Interaction, button: Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This is not your task.", ephemeral=True)
            return

        if self.user_id in active_sessions:
            active_sessions[self.user_id]["cancelled"] = True

        await leave_queue(self.user_id)
        await promote_next()
        await interaction.response.edit_message(content="Task cancelled.", embed=None, view=None, attachments=[])
        try:
            await interaction.user.send("Your task was cancelled and the slot has been released.")
        except Exception:
            pass

# ====================== SOLVER LOOP ======================
async def run_solver(user_id: int, user: discord.User):
    session = active_sessions.get(user_id)
    if not session:
        return

    min_delay = session.get("min_delay", 8)
    max_delay = session.get("max_delay", 20)

    progress_msg = None
    start_time = time.time()

    try:
        async with async_playwright() as p:
            context = await create_stealth_context(p)
            page = await context.new_page()

            # Login
            ok = await sparx_login(page, session["username"], session["password"])
            if not ok:
                await user.send("Login failed. Please check credentials and try again.")
                await leave_queue(user_id)
                return

            await user.send("Logged in successfully. Starting homework...")

            # Placeholder solving loop – replace with real question detection
            total_questions = 40
            completed = 0

            while completed < total_questions:
                if session.get("cancelled"):
                    break

                # TODO: real question detection + Gemini solve + answer injection
                completed += 1
                percent = int((completed / total_questions) * 100)
                elapsed = int(time.time() - start_time)
                elapsed_str = f"{elapsed // 60}m {elapsed % 60}s"

                png = create_progress_png(
                    percent=percent,
                    current=f"Question {completed}",
                    completed=f"{completed} / {total_questions}",
                    elapsed=elapsed_str
                )

                embed = Embed(color=Color.dark_blue())
                embed.set_image(url="attachment://progress.png")
                file = File(png, filename="progress.png")

                if progress_msg is None:
                    progress_msg = await user.send(embed=embed, file=file, view=CancelView(user_id))
                else:
                    await progress_msg.edit(embed=embed, attachments=[file], view=CancelView(user_id))

                delay = random.uniform(min_delay, max_delay)
                await asyncio.sleep(delay)

            if not session.get("cancelled"):
                await user.send("All tasks completed.")
            else:
                await user.send("Task stopped.")

            await context.close()

    except Exception as e:
        print(f"Solver error: {e}")
        try:
            await user.send(f"An error occurred: {e}")
        except Exception:
            pass
    finally:
        await leave_queue(user_id)
        await promote_next()
        if user_id in active_sessions:
            del active_sessions[user_id]

# ====================== BOT EVENTS ======================
@bot.event
async def on_ready():
    print(f"Rise Ai online as {bot.user}")
    bot.add_view(MainView())
    
    # CRITICAL: Ensure there is NO '#' at the start of this line
    await post_main_panel()

async def post_main_panel():
    print(f"[DEBUG] Attempting to post main panel to channel ID: {MAIN_CHANNEL_ID}")
    
    try:
        # fetch_channel is API-backed and reliable, unlike get_channel
        channel = await bot.fetch_channel(MAIN_CHANNEL_ID)
        print(f"[DEBUG] Successfully fetched channel: {channel.name}")
    except discord.NotFound:
        print(f"[ERROR] Channel ID {MAIN_CHANNEL_ID} not found.")
        return
    except discord.Forbidden:
        print(f"[ERROR] Bot lacks permission to VIEW channel {MAIN_CHANNEL_ID}.")
        return
    except Exception as e:
        print(f"[ERROR] Failed to fetch channel: {e}")
        return

    embed = Embed(
        title="Rise Ai",
        description=(
            "Press **Start Task** to choose a platform and begin.\n\n"
            "• Saved accounts to avoid hassle\n"
            "• Real-time question & task progress\n"
            "• Customizable speed settings"
        ),
        color=Color.dark_blue()
    )
    
    try:
        await channel.send(embed=embed, view=MainView())
        print("[SUCCESS] Main panel posted successfully.")
    except discord.Forbidden:
        print("[ERROR] Bot lacks permission to SEND MESSAGES in this channel.")
    except Exception as e:
        print(f"[ERROR] Failed to send message: {e}")

# ====================== RUN ======================
if __name__ == "__main__":
    required = [DISCORD_TOKEN, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY]
    if not all(required) or MAIN_CHANNEL_ID == 0:
        print("Missing one or more environment variables:")
        print("DISCORD_TOKEN, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY, MAIN_CHANNEL_ID")
    else:
        bot.run(DISCORD_TOKEN)
