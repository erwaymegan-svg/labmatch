# LabMatch

Find Texas Tech psychology research labs that match your interests, see RA openings, and read reviews from students who worked there.

## What's in this project

| Path | What it does |
| --- | --- |
| `src/App.jsx` | The website students see |
| `src/faculty.js` | The 28 faculty copied from the TTU labs page |
| `src/shared.js` | Rules shared by the website and server (review limits, roles, tasks) |
| `netlify/functions/api.mjs` | The server: saves RA details and reviews, runs AI matching |
| `netlify/functions/weekly-check.mjs` | Checks the TTU labs page for faculty changes every week |
| `netlify/lib/` | Helpers for calling Claude and reading the TTU page |

Data (RA details, reviews, added faculty) is saved in **Netlify Blobs**, which comes with every Netlify site. There's no separate database to set up.

---

## Deploy to Netlify

### 1. Get a Claude API key

1. Go to **platform.claude.com** and sign in or create an account.
2. Add a small amount of credit under billing. The AI is used for matching searches and the weekly page check, which costs very little for a student-sized site.
3. Go to **Settings → API keys**, click **Create key**, and copy the key. It starts with `sk-ant-` and is only shown once.

### 2. Put the code on GitHub

1. Create a free account at **github.com**.
2. Click **New repository**, name it `labmatch`, and create it.
3. On the empty repository page, click **uploading an existing file**.
4. Unzip `labmatch.zip` on your computer, open the `labmatch` folder, select **everything inside it**, and drag it into the upload area. Make sure the `netlify` and `src` folders are included.
5. Click **Commit changes**.

### 3. Create the Netlify site

1. Create a free account at **netlify.com** (signing up with GitHub is easiest).
2. Click **Add new project → Import an existing project → GitHub**, and choose your `labmatch` repository.
3. Netlify reads the build settings from `netlify.toml`, so you don't need to change them.
4. Before deploying, add these **environment variables**:

| Key | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Claude API key from step 1 |
| `ADMIN_TOKEN` | A long password only you know, like 30+ random letters and numbers |
| `VITE_CONTACT_EMAIL` | *(Optional)* The email professors can use to request corrections |

5. Click **Deploy**. After a minute or two, your site is live at an address like `random-name-123.netlify.app`.
6. To choose a nicer address, go to **Project configuration → General → Project details → Change project name**, for example `labmatch-ttu`.

> If you add or change environment variables later, go to **Deploys → Trigger deploy** so the site picks them up.

---

## Sign in as the admin

On your own phone or computer, visit this address once:

```
https://YOUR-SITE.netlify.app/?admin=YOUR_ADMIN_TOKEN
```

The site saves the token on that device and removes it from the address bar. You'll see "You're signed in as the site admin" at the bottom of the page. As admin you can:

- See reviews that were hidden after 3 reports
- Remove any review, or clear reports on a review that's fine
- Remove faculty that users added

Never share the admin link. To sign out on a device, visit `/?admin=` with nothing after the equals sign.

---

## Updating the site

Any change you commit to GitHub automatically redeploys the site. Saved RA details and reviews are **not** affected by redeploys.

**If a professor joins or leaves:** the weekly check flags them on the site under "Possibly new on the page" or "Not found in the latest check." New people can be added from the site. To permanently change the built-in list, edit `src/faculty.js`.

**Weekly check logs:** in Netlify, open **Logs → Functions → weekly-check**.

---

## Test on your computer (optional)

Requires Node.js 20 or newer.

```bash
npm install
npx netlify-cli login
npx netlify-cli link
npx netlify-cli dev
```

`netlify dev` runs the website and the server functions together, using the environment variables from your Netlify site.

---

## Safety features

- Reviews are anonymous by default and require agreeing to the review guidelines.
- Email addresses and phone numbers are blocked from reviews.
- Reviews are hidden after 3 reports from different people.
- People can only delete their own reviews from the device they posted on (or the admin can remove any review).
- Rate limits: 5 reviews per day and 30 AI searches per hour for each visitor.
- The API key and admin token stay on the server and are never sent to visitors.

**Known limit:** there are no student accounts yet, so the site can't verify that a reviewer actually worked in a lab. Adding sign-in with a TTU email is a good next step before promoting the site widely.
