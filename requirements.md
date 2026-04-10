# Trip Budget Planner Requirements

## Overview
Build a responsive multi-page travel planning website with a backend that stores trip plans on disk and exposes API endpoints for trip history and aggregate insights.

## Core User Stories
- As a traveler, I can create a trip budget plan from the home page.
- As a traveler, I can save the generated trip to persistent storage.
- As a traveler, I can review previously saved trips on a history page.
- As a traveler, I can filter saved trips by travel style.
- As a traveler, I can review aggregate trip insights on a dedicated insights page.
- As a traveler, I can clear all saved trips and see the UI update immediately.

## Functional Requirements
- Provide three pages:
  - Home planner page
  - History page
  - Insights page
- Provide a navigation bar linking all pages.
- Home page form fields:
  - Trip name: required text, 2 to 40 characters after trimming.
  - Destination: required text, 2 to 50 characters after trimming.
  - Total budget: required number, minimum 100, maximum 50000.
  - Number of days: required number, minimum 1, maximum 30.
  - Travelers: required number, minimum 1, maximum 10.
  - Travel style: required select with `Shoestring`, `Balanced`, and `Comfort`.
  - Notes: optional text, maximum 160 characters.
- Home page actions:
  - `Plan My Budget`
  - `Save Trip`
  - `Reset`
- On successful planning, calculate and display:
  - Total budget
  - Daily budget
  - Budget per traveler
  - Daily per traveler
  - Risk level label based on budget sufficiency
  - Allocation percentages and dollar amounts for Lodging, Food, Transport, and Activities
- `Save Trip` must remain disabled until a valid plan has been generated.
- Saving must persist the latest valid trip plan to backend storage.
- History page must:
  - Load saved trips from the backend
  - Show newest trips first
  - Display trip name, destination, style, budget, daily budget, and risk level
  - Support client-side filtering by style
  - Support clearing all trips via the backend
- Insights page must:
  - Load aggregate stats from the backend
  - Show total saved trips
  - Show average total budget
  - Show average daily budget
  - Show most common travel style
  - Show count of trips marked `Too Tight`
- Provide empty states when no trips exist.

## Backend Requirements
- Implement a Node.js backend server.
- Persist saved trip data in a local JSON file under the workspace.
- Provide API endpoints:
  - `GET /api/trips`
  - `POST /api/trips`
  - `DELETE /api/trips`
  - `GET /api/stats`
- Validate incoming payloads on the server before saving.
- Return JSON responses with appropriate success or validation error messages.

## Risk Rules
- Compute daily-per-traveler budget as `total budget / days / travelers`.
- Risk level rules:
  - Less than 35: `Too Tight`
  - 35 to less than 80: `Balanced`
  - 80 or greater: `Comfortable`

## Allocation Rules
- Shoestring:
  - Lodging 35%
  - Food 25%
  - Transport 20%
  - Activities 20%
- Balanced:
  - Lodging 40%
  - Food 25%
  - Transport 15%
  - Activities 20%
- Comfort:
  - Lodging 45%
  - Food 20%
  - Transport 15%
  - Activities 20%

## Non-Functional Requirements
- Use semantic HTML and accessible form labels.
- Support desktop and mobile layouts.
- Keep the visual system distinctive and consistent across pages.
- Keep all artifacts runnable locally with Node and a modern Chromium browser.
