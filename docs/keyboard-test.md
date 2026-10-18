# Keyboard and input manual test

Run on a real Android device or emulator with a 640 dp-high viewport, 200% font
scale, a tall keyboard with its suggestion strip, and both gesture and three-button
navigation. Repeat in the mobile web emulator and on iOS where available. The app
is dark-mode only.

For every field below, tap it, type `wimpex`, delete the final character, paste
`wimpex`, and verify the text remains visible and the cursor/focus border remains
on the tapped field. Verify the keyboard does not cover the field or its primary
action. Scrollable forms must keep taps working while the keyboard is open.

## Authentication

- [ ] Log in: email; move to password with the email `Next` key; submit with the
  password `Done` key; verify the Log in button remains visible.
- [ ] Sign up, step 1: email and password; verify the password meter/checklist and
  Continue button remain reachable; toggle the show/hide password eye while
  typing.
- [ ] Sign up, step 2: choose month, day, and year; verify Continue stays visible.
- [ ] Sign up, step 3: enter all verification-code digits, including autofill;
  verify Verify stays visible.
- [ ] Sign up, step 4: username and display name; verify the username message and
  Continue remain visible.
- [ ] Sign up, step 5: select interests and enter any text field shown in the
  interests step; verify Create account remains visible.
- [ ] Password reset, step 1: email; verify Send code remains visible.
- [ ] Password reset, step 2: verification code; verify Verify remains visible.
- [ ] Password reset, step 3: new password and confirmation; verify the strength
  checklist and Update password remain visible.
- [ ] Complete-profile flow: username and display name; verify the Create account
  action remains visible.
- [ ] Switch between Log in and Create account while the keyboard is open; verify
  only the active form receives input and each mode retains its own values.
- [ ] Verify the keyboard dismisses on submit, back/close, step changes, and
  scroll drag, and that fields are not automatically focused during card entry.

## Other input screens and dialogs

- [ ] One-to-one chat: message field and Send button.
- [ ] Community chat: message field and Send button.
- [ ] Community Members tab: member search field.
- [ ] Post detail: comment/reply field and Send button; caption editor cue fields
  and Save captions.
- [ ] Live room: message field and Send button.
- [ ] Start live: title field and Start live stream.
- [ ] Search: query field and search submission.
- [ ] Edit profile: display name, username, bio, and link; verify Save remains
  reachable.
- [ ] Create post: caption and hashtags; verify Post remains reachable.
- [ ] Create story: caption; verify Share remains reachable.
- [ ] Create community: name, description, and rule; verify Create remains
  reachable.
- [ ] Edit community: name, description, and rule; verify Save remains reachable.
- [ ] Community post composer: post text; verify Post remains reachable.
- [ ] Report chat dialog: reason field and Submit report.
- [ ] Delete account dialog: username confirmation and Delete account.
- [ ] New conversation/group dialog: person search and group name; verify the
  selection/create actions stay reachable.
- [ ] Community invite dialog: people search.
- [ ] Followers/following sheet: search field.
- [ ] Close friends: people search.
- [ ] Communities directory: search field.
- [ ] Story detail: story reply field and Send button.
- [ ] Settings support/request form or any other input dialog added to the app:
  verify its field and submit/save action stay above the keyboard.

## Regression checks

- [ ] Repeat the login, signup, reset, chat, and composer checks after a cold
  restart and after switching between app screens.
- [ ] Test paste and autofill into email, password, username, and one-time-code
  inputs.
- [ ] Confirm no release build displays Replay or other splash/demo-only controls.
