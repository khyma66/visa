"""
Seed data script for top 20 countries and visa types
Creates initial data for the visa platform
"""

raise SystemExit("Retired legacy seed script: no database connection was opened. Use disposable staging fixtures, never production; see docs/ENVIRONMENT_ISOLATION.md.")

# Historical implementation retained below for reference only. Do not re-enable.
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.core.database import get_session
from src.models.country import Country, VisaType, VisaRequirement
from src.models.community import Community, CommunityMembership
from src.models.user import User, UserProfile
from src.models.post import Post, PostLike, PostBookmark
import json

# Top 20 countries for visa applications
TOP_COUNTRIES = [
    {
        "name": "United States",
        "code": "USA",
        "flag_url": "https://flagcdn.com/w320/us.png",
        "region": "North America",
        "visa_required_for_tourist": False,
        "top_visas": [
            {
                "name": "H-1B Visa",
                "code": "H1B",
                "category": "work",
                "description": "Specialty occupations visa for skilled workers",
                "fee_amount": 190,
                "fee_currency": "USD",
                "validity_period": "3 years (extendable to 6 years)",
                "max_stay": "3 years initially"
            },
            {
                "name": "H-4 Visa",
                "code": "H4",
                "category": "family",
                "description": "Dependent visa for H-1B visa holders' family",
                "fee_amount": 190,
                "fee_currency": "USD",
                "validity_period": "Same as H-1B",
                "max_stay": "Same as H-1B"
            },
            {
                "name": "F-1 Visa",
                "code": "F1",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 160,
                "fee_currency": "USD",
                "validity_period": "Duration of study",
                "max_stay": "Varies by program"
            },
            {
                "name": "J-1 Visa",
                "code": "J1",
                "category": "exchange",
                "description": "Exchange visitor visa for cultural exchange",
                "fee_amount": 160,
                "fee_currency": "USD",
                "validity_period": "Program-specific",
                "max_stay": "Varies by program"
            },
            {
                "name": "O-1 Visa",
                "code": "O1",
                "category": "work",
                "description": "Visa for individuals with extraordinary ability",
                "fee_amount": 190,
                "fee_currency": "USD",
                "validity_period": "3 years",
                "max_stay": "3 years initially"
            },
            {
                "name": "EB-1 Visa",
                "code": "EB1",
                "category": "immigration",
                "description": "Employment-based immigration for priority workers",
                "fee_amount": 2805,
                "fee_currency": "USD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "EB-2 Visa",
                "code": "EB2",
                "category": "immigration",
                "description": "Employment-based immigration for advanced degree holders",
                "fee_amount": 2805,
                "fee_currency": "USD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            }
        ]
    },
    {
        "name": "Canada",
        "code": "CAN",
        "flag_url": "https://flagcdn.com/w320/ca.png",
        "region": "North America",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Express Entry",
                "code": "EE",
                "category": "immigration",
                "description": "Federal skilled worker program",
                "fee_amount": 150,
                "fee_currency": "CAD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Provincial Nominee Program",
                "code": "PNP",
                "category": "immigration",
                "description": "Province-specific immigration programs",
                "fee_amount": 150,
                "fee_currency": "CAD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Work Permit",
                "code": "WP",
                "category": "work",
                "description": "Temporary work authorization",
                "fee_amount": 155,
                "fee_currency": "CAD",
                "validity_period": "Up to 4 years",
                "max_stay": "Up to 4 years"
            },
            {
                "name": "Study Permit",
                "code": "SP",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 150,
                "fee_currency": "CAD",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Family Sponsorship",
                "code": "FS",
                "category": "family",
                "description": "Family reunification program",
                "fee_amount": 75,
                "fee_currency": "CAD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Business Immigration",
                "code": "BI",
                "category": "business",
                "description": "Entrepreneur and investor programs",
                "fee_amount": 150,
                "fee_currency": "CAD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Atlantic Immigration",
                "code": "AIP",
                "category": "immigration",
                "description": "Atlantic provinces immigration program",
                "fee_amount": 150,
                "fee_currency": "CAD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            }
        ]
    },
    {
        "name": "United Kingdom",
        "code": "GBR",
        "flag_url": "https://flagcdn.com/w320/gb.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Skilled Worker Visa",
                "code": "SW",
                "category": "work",
                "description": "General work visa for skilled professionals",
                "fee_amount": 610,
                "fee_currency": "GBP",
                "validity_period": "Up to 5 years",
                "max_stay": "Up to 5 years"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 363,
                "fee_currency": "GBP",
                "validity_period": "Duration of course",
                "max_stay": "Duration of course"
            },
            {
                "name": "Global Talent Visa",
                "code": "GT",
                "category": "work",
                "description": "Visa for leaders in science, humanities, engineering",
                "fee_amount": 623,
                "fee_currency": "GBP",
                "validity_period": "Up to 5 years",
                "max_stay": "Up to 5 years"
            },
            {
                "name": "Family Visa",
                "code": "FAM",
                "category": "family",
                "description": "Visa for family members of UK citizens",
                "fee_amount": 388,
                "fee_currency": "GBP",
                "validity_period": "2.5 years (extendable)",
                "max_stay": "2.5 years initially"
            },
            {
                "name": "Graduate Route",
                "code": "GR",
                "category": "work",
                "description": "Post-study work visa for graduates",
                "fee_amount": 715,
                "fee_currency": "GBP",
                "validity_period": "2-3 years",
                "max_stay": "2-3 years"
            },
            {
                "name": "Start-up Visa",
                "code": "SU",
                "category": "business",
                "description": "Visa for new entrepreneurs",
                "fee_amount": 378,
                "fee_currency": "GBP",
                "validity_period": "2 years",
                "max_stay": "2 years"
            },
            {
                "name": "Innovator Visa",
                "code": "INN",
                "category": "business",
                "description": "Visa for experienced entrepreneurs",
                "fee_amount": 378,
                "fee_currency": "GBP",
                "validity_period": "3 years (extendable)",
                "max_stay": "3 years initially"
            }
        ]
    },
    {
        "name": "Australia",
        "code": "AUS",
        "flag_url": "https://flagcdn.com/w320/au.png",
        "region": "Oceania",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Skilled Independent Visa",
                "code": "189",
                "category": "immigration",
                "description": "Points-based skilled migration",
                "fee_amount": 4115,
                "fee_currency": "AUD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Skilled Nominated Visa",
                "code": "190",
                "category": "immigration",
                "description": "State-nominated skilled migration",
                "fee_amount": 4115,
                "fee_currency": "AUD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Temporary Skill Shortage",
                "code": "TSS",
                "category": "work",
                "description": "Temporary work visa for skilled workers",
                "fee_amount": 405,
                "fee_currency": "AUD",
                "validity_period": "2-4 years",
                "max_stay": "2-4 years"
            },
            {
                "name": "Student Visa",
                "code": "500",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 630,
                "fee_currency": "AUD",
                "validity_period": "Duration of course",
                "max_stay": "Duration of course"
            },
            {
                "name": "Partner Visa",
                "code": "820/801",
                "category": "family",
                "description": "Visa for partners of Australian citizens",
                "fee_amount": 7715,
                "fee_currency": "AUD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Employer Nomination Scheme",
                "code": "186",
                "category": "immigration",
                "description": "Permanent employer-sponsored visa",
                "fee_amount": 4115,
                "fee_currency": "AUD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Working Holiday Visa",
                "code": "417",
                "category": "work",
                "description": "Work and holiday visa for young people",
                "fee_amount": 495,
                "fee_currency": "AUD",
                "validity_period": "1 year",
                "max_stay": "1 year"
            }
        ]
    },
    {
        "name": "Germany",
        "code": "DEU",
        "flag_url": "https://flagcdn.com/w320/de.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Blue Card",
                "code": "BC",
                "category": "work",
                "description": "EU Blue Card for highly qualified workers",
                "fee_amount": 100,
                "fee_currency": "EUR",
                "validity_period": "4 years (extendable)",
                "max_stay": "4 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 75,
                "fee_currency": "EUR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Job Seeker Visa",
                "code": "JS",
                "category": "work",
                "description": "Visa for job seekers in Germany",
                "fee_amount": 100,
                "fee_currency": "EUR",
                "validity_period": "6 months",
                "max_stay": "6 months"
            },
            {
                "name": "Family Reunification",
                "code": "FR",
                "category": "family",
                "description": "Visa for family members of German citizens",
                "fee_amount": 60,
                "fee_currency": "EUR",
                "validity_period": "1-3 years (extendable)",
                "max_stay": "1-3 years initially"
            },
            {
                "name": "EU Residence Permit",
                "code": "EU",
                "category": "immigration",
                "description": "Long-term EU residence permit",
                "fee_amount": 96,
                "fee_currency": "EUR",
                "validity_period": "5 years (renewable)",
                "max_stay": "5 years initially"
            },
            {
                "name": "Entrepreneur Visa",
                "code": "ENT",
                "category": "business",
                "description": "Visa for business founders",
                "fee_amount": 100,
                "fee_currency": "EUR",
                "validity_period": "3 years (extendable)",
                "max_stay": "3 years initially"
            },
            {
                "name": "Research Visa",
                "code": "RES",
                "category": "work",
                "description": "Visa for researchers and scientists",
                "fee_amount": 75,
                "fee_currency": "EUR",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            }
        ]
    },
    {
        "name": "Netherlands",
        "code": "NLD",
        "flag_url": "https://flagcdn.com/w320/nl.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Highly Skilled Migrant",
                "code": "HSM",
                "category": "work",
                "description": "Visa for highly skilled workers",
                "fee_amount": 331,
                "fee_currency": "EUR",
                "validity_period": "5 years (extendable)",
                "max_stay": "5 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 210,
                "fee_currency": "EUR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Orientation Year",
                "code": "OY",
                "category": "work",
                "description": "Search year visa for recent graduates",
                "fee_amount": 210,
                "fee_currency": "EUR",
                "validity_period": "1 year",
                "max_stay": "1 year"
            },
            {
                "name": "Family Reunification",
                "code": "FR",
                "category": "family",
                "description": "Visa for family members",
                "fee_amount": 286,
                "fee_currency": "EUR",
                "validity_period": "1 year (renewable)",
                "max_stay": "1 year initially"
            },
            {
                "name": "Startup Visa",
                "code": "SU",
                "category": "business",
                "description": "Visa for startup founders",
                "fee_amount": 420,
                "fee_currency": "EUR",
                "validity_period": "2 years",
                "max_stay": "2 years"
            },
            {
                "name": "EU Blue Card",
                "code": "BC",
                "category": "work",
                "description": "EU Blue Card for highly skilled workers",
                "fee_amount": 331,
                "fee_currency": "EUR",
                "validity_period": "4 years (extendable)",
                "max_stay": "4 years initially"
            },
            {
                "name": "Scientific Researcher",
                "code": "SR",
                "category": "work",
                "description": "Visa for scientific researchers",
                "fee_amount": 210,
                "fee_currency": "EUR",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            }
        ]
    },
    {
        "name": "Singapore",
        "code": "SGP",
        "flag_url": "https://flagcdn.com/w320/sg.png",
        "region": "Asia",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Employment Pass",
                "code": "EP",
                "category": "work",
                "description": "Work permit for professionals",
                "fee_amount": 105,
                "fee_currency": "SGD",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Student Pass",
                "code": "STP",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 30,
                "fee_currency": "SGD",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "S Pass",
                "code": "SP",
                "category": "work",
                "description": "Work permit for mid-level skilled workers",
                "fee_amount": 80,
                "fee_currency": "SGD",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Dependent Pass",
                "code": "DP",
                "category": "family",
                "description": "Pass for family members of work pass holders",
                "fee_amount": 30,
                "fee_currency": "SGD",
                "validity_period": "Same as sponsor",
                "max_stay": "Same as sponsor"
            },
            {
                "name": "Entrepreneur Pass",
                "code": "EP",
                "category": "business",
                "description": "Pass for business owners and entrepreneurs",
                "fee_amount": 105,
                "fee_currency": "SGD",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Tech.Pass",
                "code": "TP",
                "category": "work",
                "description": "Pass for tech professionals and founders",
                "fee_amount": 195,
                "fee_currency": "SGD",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "One Pass",
                "code": "OP",
                "category": "work",
                "description": "Overseas Networks & Expertise Pass",
                "fee_amount": 105,
                "fee_currency": "SGD",
                "validity_period": "5 years (renewable)",
                "max_stay": "5 years initially"
            }
        ]
    },
    {
        "name": "Switzerland",
        "code": "CHE",
        "flag_url": "https://flagcdn.com/w320/ch.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "L Permit",
                "code": "L",
                "category": "work",
                "description": "Short-term residence permit",
                "fee_amount": 100,
                "fee_currency": "CHF",
                "validity_period": "1 year (extendable to 2)",
                "max_stay": "1 year initially"
            },
            {
                "name": "B Permit",
                "code": "B",
                "category": "work",
                "description": "Initial residence permit",
                "fee_amount": 100,
                "fee_currency": "CHF",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "C Permit",
                "code": "C",
                "category": "immigration",
                "description": "Settlement permit",
                "fee_amount": 100,
                "fee_currency": "CHF",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 40,
                "fee_currency": "CHF",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Family Reunification",
                "code": "FR",
                "category": "family",
                "description": "Visa for family members",
                "fee_amount": 40,
                "fee_currency": "CHF",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "EU/EFTA Agreement",
                "code": "EU",
                "category": "work",
                "description": "Agreement for EU/EFTA nationals",
                "fee_amount": 100,
                "fee_currency": "CHF",
                "validity_period": "Varies by category",
                "max_stay": "Varies by category"
            },
            {
                "name": "Pensioner Visa",
                "code": "PEN",
                "category": "immigration",
                "description": "Visa for retired persons",
                "fee_amount": 100,
                "fee_currency": "CHF",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            }
        ]
    },
    {
        "name": "Japan",
        "code": "JPN",
        "flag_url": "https://flagcdn.com/w320/jp.png",
        "region": "Asia",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Work Visa",
                "code": "WV",
                "category": "work",
                "description": "General work visa for skilled workers",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "3-5 years (renewable)",
                "max_stay": "3-5 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Spouse Visa",
                "code": "SP",
                "category": "family",
                "description": "Visa for spouses of Japanese citizens",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "6 months - 5 years",
                "max_stay": "6 months - 5 years"
            },
            {
                "name": "Business Manager Visa",
                "code": "BM",
                "category": "business",
                "description": "Visa for business managers and investors",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "Highly Skilled Professional",
                "code": "HSP",
                "category": "work",
                "description": "Fast-track visa for highly skilled professionals",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "5 years (extendable)",
                "max_stay": "5 years initially"
            },
            {
                "name": "Intern Visa",
                "code": "INT",
                "category": "work",
                "description": "Internship visa for students and graduates",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "1 year",
                "max_stay": "1 year"
            },
            {
                "name": "Training Visa",
                "code": "TR",
                "category": "work",
                "description": "Technical training visa",
                "fee_amount": 3000,
                "fee_currency": "JPY",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            }
        ]
    },
    {
        "name": "South Korea",
        "code": "KOR",
        "flag_url": "https://flagcdn.com/w320/kr.png",
        "region": "Asia",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "E-7 Visa",
                "code": "E7",
                "category": "work",
                "description": "Work visa for specific occupations",
                "fee_amount": 40000,
                "fee_currency": "KRW",
                "validity_period": "1-3 years",
                "max_stay": "1-3 years"
            },
            {
                "name": "D-2 Visa",
                "code": "D2",
                "category": "student",
                "description": "Student visa for university studies",
                "fee_amount": 50000,
                "fee_currency": "KRW",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "F-4 Visa",
                "code": "F4",
                "category": "work",
                "description": "Work visa for Korean diaspora",
                "fee_amount": 50000,
                "fee_currency": "KRW",
                "validity_period": "3 years (renewable)",
                "max_stay": "3 years initially"
            },
            {
                "name": "F-6 Visa",
                "code": "F6",
                "category": "family",
                "description": "Marriage visa for foreign spouses",
                "fee_amount": 50000,
                "fee_currency": "KRW",
                "validity_period": "1-3 years (renewable)",
                "max_stay": "1-3 years initially"
            },
            {
                "name": "C-3 Visa",
                "code": "C3",
                "category": "tourist",
                "description": "Short-term tourist visa",
                "fee_amount": 20000,
                "fee_currency": "KRW",
                "validity_period": "90 days",
                "max_stay": "90 days"
            },
            {
                "name": "D-1 Visa",
                "code": "D1",
                "category": "student",
                "description": "Student visa for language studies",
                "fee_amount": 40000,
                "fee_currency": "KRW",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "H-2 Visa",
                "code": "H2",
                "category": "work",
                "description": "Work visa for Korean diaspora",
                "fee_amount": 50000,
                "fee_currency": "KRW",
                "validity_period": "5 years",
                "max_stay": "5 years"
            }
        ]
    },
    {
        "name": "France",
        "code": "FRA",
        "flag_url": "https://flagcdn.com/w320/fr.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Talent Passport",
                "code": "TP",
                "category": "work",
                "description": "Multi-year work visa for skilled workers",
                "fee_amount": 225,
                "fee_currency": "EUR",
                "validity_period": "4 years (renewable)",
                "max_stay": "4 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 99,
                "fee_currency": "EUR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Family Reunification",
                "code": "FR",
                "category": "family",
                "description": "Visa for family members of French citizens",
                "fee_amount": 99,
                "fee_currency": "EUR",
                "validity_period": "1-10 years",
                "max_stay": "1-10 years"
            },
            {
                "name": "Entrepreneur Visa",
                "code": "ENT",
                "category": "business",
                "description": "Visa for business creators",
                "fee_amount": 225,
                "fee_currency": "EUR",
                "validity_period": "4 years (renewable)",
                "max_stay": "4 years initially"
            },
            {
                "name": "Work Visa",
                "code": "WV",
                "category": "work",
                "description": "General work visa",
                "fee_amount": 225,
                "fee_currency": "EUR",
                "validity_period": "1-3 years",
                "max_stay": "1-3 years"
            },
            {
                "name": "Search Visa",
                "code": "SV",
                "category": "work",
                "description": "Job search visa for graduates",
                "fee_amount": 99,
                "fee_currency": "EUR",
                "validity_period": "1 year",
                "max_stay": "1 year"
            },
            {
                "name": "Long-stay Tourist",
                "code": "LT",
                "category": "tourist",
                "description": "Long-term tourist visa",
                "fee_amount": 99,
                "fee_currency": "EUR",
                "validity_period": "1 year",
                "max_stay": "1 year"
            }
        ]
    },
    {
        "name": "Sweden",
        "code": "SWE",
        "flag_url": "https://flagcdn.com/w320/se.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Work Permit",
                "code": "WP",
                "category": "work",
                "description": "Work permit for skilled workers",
                "fee_amount": 2000,
                "fee_currency": "SEK",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 1000,
                "fee_currency": "SEK",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Residence Permit",
                "code": "RP",
                "category": "family",
                "description": "Residence permit for family members",
                "fee_amount": 1000,
                "fee_currency": "SEK",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "EU Blue Card",
                "code": "BC",
                "category": "work",
                "description": "EU Blue Card for highly skilled workers",
                "fee_amount": 2000,
                "fee_currency": "SEK",
                "validity_period": "2-4 years",
                "max_stay": "2-4 years"
            },
            {
                "name": "Business Visa",
                "code": "BV",
                "category": "business",
                "description": "Business and investor visa",
                "fee_amount": 2000,
                "fee_currency": "SEK",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Research Visa",
                "code": "RV",
                "category": "work",
                "description": "Research and academic visa",
                "fee_amount": 1000,
                "fee_currency": "SEK",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            },
            {
                "name": "Job Seeker Visa",
                "code": "JS",
                "category": "work",
                "description": "Job search visa for skilled workers",
                "fee_amount": 2000,
                "fee_currency": "SEK",
                "validity_period": "4-6 months",
                "max_stay": "4-6 months"
            }
        ]
    },
    {
        "name": "Norway",
        "code": "NOR",
        "flag_url": "https://flagcdn.com/w320/no.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Work Permit",
                "code": "WP",
                "category": "work",
                "description": "Work permit for skilled workers",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Residence Permit",
                "code": "RP",
                "category": "family",
                "description": "Residence permit for family members",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "Skilled Worker",
                "code": "SW",
                "category": "work",
                "description": "Skilled worker permit",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "Seasonal Worker",
                "code": "SW",
                "category": "work",
                "description": "Seasonal work permit",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "6 months",
                "max_stay": "6 months"
            },
            {
                "name": "Researcher Visa",
                "code": "RV",
                "category": "work",
                "description": "Research and academic visa",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            },
            {
                "name": "Business Visa",
                "code": "BV",
                "category": "business",
                "description": "Business and investor visa",
                "fee_amount": 600,
                "fee_currency": "NOK",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            }
        ]
    },
    {
        "name": "Denmark",
        "code": "DNK",
        "flag_url": "https://flagcdn.com/w320/dk.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Work Permit",
                "code": "WP",
                "category": "work",
                "description": "Work permit for skilled workers",
                "fee_amount": 3705,
                "fee_currency": "DKK",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 1855,
                "fee_currency": "DKK",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Residence Permit",
                "code": "RP",
                "category": "family",
                "description": "Residence permit for family members",
                "fee_amount": 1855,
                "fee_currency": "DKK",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "Positive List",
                "code": "PL",
                "category": "work",
                "description": "Work permit for occupations on positive list",
                "fee_amount": 3705,
                "fee_currency": "DKK",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "Pay Limit Scheme",
                "code": "PLS",
                "category": "work",
                "description": "Work permit with salary requirements",
                "fee_amount": 3705,
                "fee_currency": "DKK",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "Researcher Visa",
                "code": "RV",
                "category": "work",
                "description": "Research and academic visa",
                "fee_amount": 1855,
                "fee_currency": "DKK",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            },
            {
                "name": "Startup Visa",
                "code": "SU",
                "category": "business",
                "description": "Visa for startup founders",
                "fee_amount": 3705,
                "fee_currency": "DKK",
                "validity_period": "2 years (extendable)",
                "max_stay": "2 years initially"
            }
        ]
    },
    {
        "name": "Finland",
        "code": "FIN",
        "flag_url": "https://flagcdn.com/w320/fi.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Work Permit",
                "code": "WP",
                "category": "work",
                "description": "Work permit for skilled workers",
                "fee_amount": 500,
                "fee_currency": "EUR",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Residence Permit",
                "code": "RP",
                "category": "family",
                "description": "Residence permit for family members",
                "fee_amount": 500,
                "fee_currency": "EUR",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "EU Blue Card",
                "code": "BC",
                "category": "work",
                "description": "EU Blue Card for highly skilled workers",
                "fee_amount": 500,
                "fee_currency": "EUR",
                "validity_period": "1-4 years",
                "max_stay": "1-4 years"
            },
            {
                "name": "Researcher Visa",
                "code": "RV",
                "category": "work",
                "description": "Research and academic visa",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            },
            {
                "name": "Seasonal Worker",
                "code": "SW",
                "category": "work",
                "description": "Seasonal work permit",
                "fee_amount": 500,
                "fee_currency": "EUR",
                "validity_period": "90 days - 8 months",
                "max_stay": "90 days - 8 months"
            },
            {
                "name": "Startup Visa",
                "code": "SU",
                "category": "business",
                "description": "Visa for startup founders",
                "fee_amount": 500,
                "fee_currency": "EUR",
                "validity_period": "2 years (extendable)",
                "max_stay": "2 years initially"
            }
        ]
    },
    {
        "name": "Ireland",
        "code": "IRL",
        "flag_url": "https://flagcdn.com/w320/ie.png",
        "region": "Europe",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Critical Skills Visa",
                "code": "CS",
                "category": "work",
                "description": "Visa for critical skills occupations",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "General Work Permit",
                "code": "GWP",
                "category": "work",
                "description": "General work permit for skilled workers",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 60,
                "fee_currency": "EUR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Spouse/Partner Visa",
                "code": "SP",
                "category": "family",
                "description": "Visa for spouses and partners",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Business Permission",
                "code": "BP",
                "category": "business",
                "description": "Business permission for entrepreneurs",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Researcher Visa",
                "code": "RV",
                "category": "work",
                "description": "Research and academic visa",
                "fee_amount": 60,
                "fee_currency": "EUR",
                "validity_period": "Duration of research",
                "max_stay": "Duration of research"
            },
            {
                "name": "Graduate Visa",
                "code": "GV",
                "category": "work",
                "description": "Post-study work visa",
                "fee_amount": 300,
                "fee_currency": "EUR",
                "validity_period": "2 years",
                "max_stay": "2 years"
            }
        ]
    },
    {
        "name": "New Zealand",
        "code": "NZL",
        "flag_url": "https://flagcdn.com/w320/nz.png",
        "region": "Oceania",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Skilled Migrant Category",
                "code": "SMC",
                "category": "immigration",
                "description": "Points-based skilled migration",
                "fee_amount": 3860,
                "fee_currency": "NZD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Work to Residence",
                "code": "WTR",
                "category": "work",
                "description": "Work visa leading to residence",
                "fee_amount": 486,
                "fee_currency": "NZD",
                "validity_period": "30 months",
                "max_stay": "30 months"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 330,
                "fee_currency": "NZD",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Partner of NZ Citizen",
                "code": "PNC",
                "category": "family",
                "description": "Visa for partners of NZ citizens",
                "fee_amount": 275,
                "fee_currency": "NZD",
                "validity_period": "2 years (leading to residence)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Employer Accreditation",
                "code": "EA",
                "category": "work",
                "description": "Accreditation for employers",
                "fee_amount": 610,
                "fee_currency": "NZD",
                "validity_period": "12 months - 2 years",
                "max_stay": "12 months - 2 years"
            },
            {
                "name": "Investor Visa",
                "code": "IV",
                "category": "immigration",
                "description": "Investment-based immigration",
                "fee_amount": 3860,
                "fee_currency": "NZD",
                "validity_period": "Permanent",
                "max_stay": "Permanent residency"
            },
            {
                "name": "Working Holiday Visa",
                "code": "WHV",
                "category": "work",
                "description": "Work and holiday visa",
                "fee_amount": 330,
                "fee_currency": "NZD",
                "validity_period": "12 months",
                "max_stay": "12 months"
            }
        ]
    },
    {
        "name": "UAE",
        "code": "ARE",
        "flag_url": "https://flagcdn.com/w320/ae.png",
        "region": "Middle East",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Golden Visa",
                "code": "GV",
                "category": "immigration",
                "description": "Long-term residence visa for investors and entrepreneurs",
                "fee_amount": 2800,
                "fee_currency": "AED",
                "validity_period": "10 years",
                "max_stay": "10 years"
            },
            {
                "name": "Work Visa",
                "code": "WV",
                "category": "work",
                "description": "General work visa for skilled workers",
                "fee_amount": 500,
                "fee_currency": "AED",
                "validity_period": "2-3 years",
                "max_stay": "2-3 years"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 300,
                "fee_currency": "AED",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Family Visa",
                "code": "FV",
                "category": "family",
                "description": "Family sponsorship visa",
                "fee_amount": 300,
                "fee_currency": "AED",
                "validity_period": "2-3 years",
                "max_stay": "2-3 years"
            },
            {
                "name": "Tourist Visa",
                "code": "TV",
                "category": "tourist",
                "description": "Tourist visa for visitors",
                "fee_amount": 100,
                "fee_currency": "AED",
                "validity_period": "30-90 days",
                "max_stay": "30-90 days"
            },
            {
                "name": "Business Visa",
                "code": "BV",
                "category": "business",
                "description": "Business and investor visa",
                "fee_amount": 500,
                "fee_currency": "AED",
                "validity_period": "2-3 years",
                "max_stay": "2-3 years"
            },
            {
                "name": "Retirement Visa",
                "code": "RV",
                "category": "immigration",
                "description": "Retirement visa for retirees",
                "fee_amount": 2800,
                "fee_currency": "AED",
                "validity_period": "5 years",
                "max_stay": "5 years"
            }
        ]
    },
    {
        "name": "Hong Kong",
        "code": "HKG",
        "flag_url": "https://flagcdn.com/w320/hk.png",
        "region": "Asia",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "General Employment Policy",
                "code": "GEP",
                "category": "work",
                "description": "General work visa for skilled professionals",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "Quality Migrant Admission Scheme",
                "code": "QMAS",
                "category": "immigration",
                "description": "Points-based immigration scheme",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "2 years (extendable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Student Visa",
                "code": "STU",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Dependent Visa",
                "code": "DV",
                "category": "family",
                "description": "Visa for family members",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "Same as sponsor",
                "max_stay": "Same as sponsor"
            },
            {
                "name": "Investment Holder",
                "code": "IH",
                "category": "business",
                "description": "Visa for business investors",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "2 years (renewable)",
                "max_stay": "2 years initially"
            },
            {
                "name": "Employment Pass",
                "code": "EP",
                "category": "work",
                "description": "Employment pass for professionals",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "1-2 years",
                "max_stay": "1-2 years"
            },
            {
                "name": "Training Visa",
                "code": "TV",
                "category": "work",
                "description": "Training visa for skill development",
                "fee_amount": 230,
                "fee_currency": "HKD",
                "validity_period": "1 year",
                "max_stay": "1 year"
            }
        ]
    },
    {
        "name": "Malaysia",
        "code": "MYS",
        "flag_url": "https://flagcdn.com/w320/my.png",
        "region": "Asia",
        "visa_required_for_tourist": True,
        "top_visas": [
            {
                "name": "Malaysia My Second Home",
                "code": "MM2H",
                "category": "immigration",
                "description": "Long-term residence program",
                "fee_amount": 5000,
                "fee_currency": "MYR",
                "validity_period": "10 years",
                "max_stay": "10 years"
            },
            {
                "name": "Employment Pass",
                "code": "EP",
                "category": "work",
                "description": "Work permit for skilled professionals",
                "fee_amount": 300,
                "fee_currency": "MYR",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            },
            {
                "name": "Student Pass",
                "code": "SP",
                "category": "student",
                "description": "Student visa for academic studies",
                "fee_amount": 300,
                "fee_currency": "MYR",
                "validity_period": "Duration of study",
                "max_stay": "Duration of study"
            },
            {
                "name": "Dependant Pass",
                "code": "DP",
                "category": "family",
                "description": "Visa for family members",
                "fee_amount": 300,
                "fee_currency": "MYR",
                "validity_period": "Same as sponsor",
                "max_stay": "Same as sponsor"
            },
            {
                "name": "Professional Visit Pass",
                "code": "PVP",
                "category": "work",
                "description": "Short-term professional work visa",
                "fee_amount": 300,
                "fee_currency": "MYR",
                "validity_period": "6 months - 2 years",
                "max_stay": "6 months - 2 years"
            },
            {
                "name": "Social Visit Pass",
                "code": "SVP",
                "category": "tourist",
                "description": "Social visit visa",
                "fee_amount": 100,
                "fee_currency": "MYR",
                "validity_period": "30-90 days",
                "max_stay": "30-90 days"
            },
            {
                "name": "Business Visa",
                "code": "BV",
                "category": "business",
                "description": "Business and investor visa",
                "fee_amount": 300,
                "fee_currency": "MYR",
                "validity_period": "1-5 years",
                "max_stay": "1-5 years"
            }
        ]
    }
]

async def seed_countries_and_visas():
    """Seed database with countries and visa types"""
    async for session in get_session():
        try:
            # Clear existing data
            await session.execute("DELETE FROM visa_requirement")
            await session.execute("DELETE FROM visa_type")
            await session.execute("DELETE FROM community")
            await session.execute("DELETE FROM country")
            await session.commit()

            # Create countries and visas
            for country_data in TOP_COUNTRIES:
                # Create country
                country = Country(
                    name=country_data["name"],
                    code=country_data["code"],
                    flag_url=country_data["flag_url"],
                    region=country_data["region"],
                    visa_required_for_tourist=country_data["visa_required_for_tourist"]
                )
                session.add(country)
                await session.flush()  # Get country ID

                # Create visa types
                for visa_data in country_data["top_visas"]:
                    visa_type = VisaType(
                        country_id=country.id,
                        name=visa_data["name"],
                        code=visa_data["code"],
                        category=visa_data["category"],
                        description=visa_data["description"],
                        fee_amount=visa_data["fee_amount"],
                        fee_currency=visa_data["fee_currency"],
                        validity_period=visa_data["validity_period"],
                        max_stay=visa_data["max_stay"],
                        is_active=True
                    )
                    session.add(visa_type)

                # Create community for country
                community = Community(
                    name=f"{country_data['name']} Visa Community",
                    slug=f"{country_data['code'].lower()}-visa-community",
                    description=f"Community for {country_data['name']} visa information and discussions",
                    country_id=country.id,
                    community_type="country_specific"
                )
                session.add(community)

            await session.commit()
            print(f"Successfully seeded {len(TOP_COUNTRIES)} countries with visa types")

        except Exception as e:
            await session.rollback()
            print(f"Error seeding data: {e}")
        finally:
            await session.close()

if __name__ == "__main__":
    asyncio.run(seed_countries_and_visas())
