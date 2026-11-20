import unittest

from pydantic import ValidationError

from app.schemas import Credentials, Criterion, Filters, Opportunity, Profile, Registration
from tests.helpers import complete_profile, opportunity


class ValidationTests(unittest.TestCase):
    def test_unknown_filter_is_rejected(self):
        with self.assertRaises(ValidationError):
            Filters(orientador="Fulano")

    def test_duration_and_pagination_equivalence_classes(self):
        invalid = [{"min": 0}, {"max": -1}, {"min": 6.5}, {"min": 12, "max": 6},
                   {"limite": 0}, {"limite": 101}, {"offset": -1}, {"nivel": "doutorado"},
                   {"offset": 2**63}, {"min": 2**63}, {"max": 2**63}]
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Filters(**data)
        for data in ({"min": 6, "max": 6}, {"limite": 1}, {"limite": 100}, {"offset": 0}):
            with self.subTest(data=data):
                Filters(**data)

    def test_empty_filters_do_not_restrict(self):
        filters = Filters(min="", max=" ", pais=" ")
        self.assertIsNone(filters.min)
        self.assertIsNone(filters.max)
        self.assertEqual(filters.pais, "")

    def test_profile_numeric_boundaries(self):
        for data in ({"i3": -0.01}, {"i3": 10.01}, {"creditos": -1}, {"creditos": 101},
                     {"i3": float("nan")}, {"creditos": float("inf")}, {"i3": True}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Profile(**complete_profile(**data))
        for data in ({"i3": 0, "creditos": 0}, {"i3": 10, "creditos": 100}):
            Profile(**complete_profile(**data))

    def test_credit_counts_consistency(self):
        invalid = [{"creditos": None, "creditos_concluidos": 40},
                   {"creditos": None, "creditos_totais": 100},
                   {"creditos": None, "creditos_concluidos": 1, "creditos_totais": 0},
                   {"creditos": None, "creditos_concluidos": 101, "creditos_totais": 100},
                   {"creditos_concluidos": 40, "creditos_totais": 100},
                   {"creditos": None, "creditos_concluidos": 4.5, "creditos_totais": 100}]
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Profile(**complete_profile(**data))

    def test_invalid_languages_and_references(self):
        for data in ({"idiomas": {"Inglês": "D3"}}, {"idiomas": {"Klingon": "B2"}},
                     {"documentos": {"historico_escolar": " "}}, {"experiencias": [" "]}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Profile(**complete_profile(**data))

    def test_opportunity_requires_explicit_mandatory_flag(self):
        edital = opportunity()
        del edital["requisitos"][0]["obrigatorio"]
        with self.assertRaises(ValidationError):
            Opportunity(**edital)

    def test_criterion_invalid_configuration(self):
        base = {"campo": "i3", "rotulo": "I3", "esperado": 7, "obrigatorio": True}
        for data in ({"peso": -1}, {"esperado": 11}, {"campo": "documento", "esperado": "Presente"},
                     {"campo": "idioma", "esperado": "D3"}, {"campo": "nivel", "esperado": "outro"}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Criterion(**{**base, **data})

    def test_email_normalization_and_name_validation(self):
        user = Registration(nome="  Aluno  ", email=" Aluno@EXAMPLE.COM ", senha="senha-segura")
        self.assertEqual(user.nome, "Aluno")
        self.assertEqual(user.email, "aluno@example.com")
        for email in ("aluno", "a@@b.com", "a b@example.com"):
            with self.subTest(email=email), self.assertRaises(ValidationError):
                Credentials(email=email, senha="senha-segura")
        with self.assertRaises(ValidationError):
            Registration(nome=" ", email="a@example.com", senha="senha-segura")

    def test_password_length_and_literal_spaces(self):
        password = " senha com espaços "
        self.assertEqual(Credentials(email="a@b.com", senha=password).senha, password)
        for password in ("1234567", "x" * 129):
            with self.subTest(length=len(password)), self.assertRaises(ValidationError):
                Credentials(email="a@b.com", senha=password)


if __name__ == "__main__":
    unittest.main()

