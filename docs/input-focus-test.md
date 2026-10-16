# Android input focus checklist

Run on a real Android device with the development build. Test in portrait, light and
dark themes, with gesture navigation and three-button navigation. For every text
field, tap its left edge, floating-label area (when present), center, and right
edge. Confirm the cursor appears and the keyboard opens on the first tap. Repeat
after closing and reopening the screen; do not type during the edge-hit test.

## Authentication

- [ ] Log in: email and password; tap the password eye separately.
- [ ] Create account, step 1: email and password.
- [ ] Create account, step 2: birthday pickers; no hidden text field autofocuses.
- [ ] Create account, step 3: each one-time-code box; the first box receives the
      intended initial focus only after the card transition.
- [ ] Create account, step 4: username and display name.
- [ ] Create account, step 5: interests; confirm there is no accidental autofocus.
- [ ] Complete profile: username and display name.
- [ ] Password reset, step 1: email.
- [ ] Password reset, step 2: each one-time-code box.
- [ ] Password reset, step 3: new password and confirmation.
- [ ] Switch auth modes and steps while the keyboard is open; inactive inputs do
      not receive taps or autofill.
- [ ] Tap the card outside an input to dismiss the keyboard. Verify the welcome
      layer and splash backdrop do not intercept card taps.
- [ ] Verify email Return moves to password, password Return submits or advances,
      and username/name/code Return behavior follows the flow.

## Other app screens

- [ ] Edit profile: display name, username, bio, and link.
- [ ] Create community: name, description, and rule entry.
- [ ] Edit community: name, description, and rule entry.
- [ ] Create post and community post composer: caption and hashtag entry.
- [ ] Create story: caption.
- [ ] Search: search query; tap results and recent-search controls without
      accidentally refocusing the query.
- [ ] Close friends and group/chat search fields.
- [ ] Report details in chat/community/post flows.
- [ ] Support request form and delete-account confirmation inputs, when shown.
- [ ] Go-live title.
- [ ] Direct/group chat composer, community chat composer, post comment/reply,
      live chat composer, and story reply.
- [ ] Chat attachment, voice-record, send, save, and submit controls remain
      tappable while the keyboard is open.

## Stress cases

- [ ] Use Android font scale 200%; no label or control overlaps the input.
- [ ] Use a tall keyboard with its suggestion strip and the emoji keyboard.
- [ ] Use a 640 dp-tall display; focused inputs and primary actions remain visible.
- [ ] Repeat with autofill suggestions visible; suggestions do not obscure the
      password field or prevent a first-tap focus.
