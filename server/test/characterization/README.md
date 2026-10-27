# Characterization tests

Characterization tests record observable behavior of the preserved OctoFarm baseline before modernization.

They answer **what does the preserved system do?** They do not answer **what should the revived system do?**

If preserved behavior conflicts with ADR-008, the provider contract, security requirements, or another higher-authority decision, keep the characterization evidence and express the required target behavior separately in provider-harness contract/compliance tests. Do not rewrite the characterization fixture to make a defect disappear.
