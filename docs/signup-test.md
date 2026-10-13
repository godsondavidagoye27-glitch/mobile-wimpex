# Sign up test checklist

- Enter an incorrect email code and confirm the code boxes clear, the row shakes, and the error is shown.
- Enter an expired email code and confirm it is rejected with the same invalid-code message.
- Wait for the resend countdown, request a new code, and confirm the success toast appears.
- Check a username already in use, then try continuing with a username that becomes unavailable before profile creation.
- Select a birthday that makes the account under 13 and confirm the form blocks continuation.
- Select a birthday for an age 14 user, complete sign up, and confirm the profile has private account and friends-only message defaults.
- Complete email verification, close the app before finishing the profile, reopen it, and confirm sign up resumes at the username step.
- Disable network access during the final profile submission, restore it, retry, and confirm profile creation completes without duplicate interests.
