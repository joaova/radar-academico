from copy import deepcopy
from datetime import timedelta
import unittest

from app.domain import credit_percentage, is_active, simulate, today
from tests.helpers import complete_profile, opportunity


class SimulationTests(unittest.TestCase):
    """SIM01–SIM06/SIM10; seção 8.1 do planejamento."""

    def test_all_criteria_met_gives_100(self):
        edital = opportunity()
        result = simulate(complete_profile(experiencias=[edital["area"]]), edital)
        self.assertEqual(result["situacao"], "compativel")
        self.assertEqual(result["indice"], 100)
        self.assertTrue(result["candidatura_habilitada"])

    def test_optional_experience_missing_does_not_block_80_percent(self):
        result = simulate(complete_profile(), opportunity())
        self.assertEqual(result["indice"], 80)
        self.assertEqual(result["situacao"], "compativel")
        self.assertTrue(result["elegivel"])
        criterion = result["nao_atendidos"][0]
        self.assertEqual(criterion["campo"], "experiencia")
        self.assertFalse(criterion["obrigatorio"])

    def test_unreported_optional_experience_is_absent_not_failed(self):
        result = simulate(complete_profile(experiencias=None), opportunity())
        self.assertEqual(result["indice"], 80)
        self.assertTrue(result["elegivel"])
        self.assertEqual(result["ausentes"][0]["campo"], "experiencia")

    def test_missing_required_document(self):
        result = simulate(complete_profile(documentos={}), opportunity())
        self.assertEqual(result["situacao"], "incompleta")
        self.assertIsNone(result["indice"])
        self.assertTrue(result["completar_perfil"])
        self.assertFalse(result["candidatura_habilitada"])
        self.assertIn("Histórico escolar não informado", result["ausentes"][0]["justificativa"])

    def test_missing_language_is_incomplete(self):
        result = simulate(complete_profile(idiomas={}), opportunity())
        self.assertTrue(result["incompleta"])
        self.assertIsNone(result["indice"])

    def test_insufficient_i3_is_incompatible_not_incomplete(self):
        result = simulate(complete_profile(i3=6.5), opportunity())
        self.assertEqual(result["situacao"], "incompativel")
        self.assertFalse(result["incompleta"])
        self.assertFalse(result["completar_perfil"])
        self.assertFalse(result["candidatura_habilitada"])
        self.assertIn("6.5", result["nao_atendidos"][0]["justificativa"])

    def test_academic_level_mismatch(self):
        result = simulate(complete_profile(nivel="pós-graduação"), opportunity())
        self.assertEqual(result["situacao"], "incompativel")
        self.assertEqual(result["nao_atendidos"][0]["campo"], "nivel")

    def test_i3_boundaries(self):
        for value, eligible in ((6.99, False), (7, True), (7.01, True)):
            with self.subTest(i3=value):
                result = simulate(complete_profile(i3=value), opportunity())
                self.assertEqual(result["elegivel"], eligible)

    def test_credit_boundaries(self):
        for value, eligible in ((39.99, False), (40, True), (40.01, True), (100, True), (0, False)):
            with self.subTest(creditos=value):
                result = simulate(complete_profile(creditos=value), opportunity())
                self.assertEqual(result["elegivel"], eligible)
                self.assertFalse(result["incompleta"])

    def test_credit_percentage_from_counts(self):
        for count, eligible in ((39, False), (40, True), (41, True)):
            with self.subTest(concluidos=count):
                profile = complete_profile(creditos=None, creditos_concluidos=count, creditos_totais=100)
                self.assertEqual(credit_percentage(profile), count)
                self.assertEqual(simulate(profile, opportunity())["elegivel"], eligible)

    def test_credit_percentage_not_rounded_before_comparison(self):
        profile = complete_profile(creditos=None, creditos_concluidos=39999, creditos_totais=100000)
        self.assertFalse(simulate(profile, opportunity())["elegivel"])

    def test_language_order_boundaries(self):
        for level, eligible in (("A1", False), ("B1", False), ("B2", True), ("C1", True), ("C2", True)):
            with self.subTest(idioma=level):
                result = simulate(complete_profile(idiomas={"Inglês": level}), opportunity())
                self.assertEqual(result["elegivel"], eligible)

    def test_zero_i3_is_known_not_absent(self):
        result = simulate(complete_profile(i3=0), opportunity())
        self.assertFalse(result["incompleta"])
        self.assertEqual(result["nao_atendidos"][0]["valor"], 0)

    def test_missing_and_failed_required_criteria_keep_both_reasons(self):
        result = simulate(complete_profile(i3=6.5, idiomas={}), opportunity())
        self.assertEqual(result["situacao"], "incompleta")
        self.assertEqual(len(result["ausentes"]), 1)
        self.assertTrue(any(c["campo"] == "i3" for c in result["nao_atendidos"]))

    def test_zero_total_weight_has_no_percentage(self):
        edital = opportunity()
        for c in edital["requisitos"]:
            c["peso"] = 0
        result = simulate(complete_profile(), edital)
        self.assertIsNone(result["indice"])
        self.assertTrue(result["elegivel"])
        self.assertTrue(all(c["contribuicao_percentual"] == 0 for c in result["criterios"]))

    def test_weights_are_configured_by_opportunity_and_round_half_up(self):
        edital = opportunity()
        for c in edital["requisitos"]:
            if c["campo"] == "idioma":
                c["peso"] = 5
            elif c["campo"] == "experiencia":
                c["peso"] = 3
        result = simulate(complete_profile(), edital)
        self.assertEqual(result["indice"], 63)  # 62,5 arredonda para cima.

    def test_per_criterion_points_and_contribution(self):
        result = simulate(complete_profile(), opportunity())
        language = next(c for c in result["criterios"] if c["campo"] == "idioma")
        self.assertEqual(language["percentual"], 100)
        self.assertEqual(language["pontos_obtidos"], 80)
        self.assertEqual(language["contribuicao_percentual"], 80)
        self.assertEqual(sum(c["contribuicao_percentual"] for c in result["criterios"]), 80)

    def test_discipline_from_structured_history(self):
        edital = opportunity()
        edital["requisitos"][-2] = {
            "campo": "disciplina", "chave": "Aprendizado de Máquina",
            "rotulo": "Experiência em Aprendizado de Máquina", "esperado": "Sim",
            "obrigatorio": False, "peso": 20,
        }
        result = simulate(complete_profile(disciplinas=["aprendizado de maquina"]), edital)
        self.assertEqual(result["indice"], 100)

    def test_language_criterion_can_use_its_own_language(self):
        edital = opportunity()
        edital["requisitos"][3]["chave"] = "Francês"
        result = simulate(complete_profile(idiomas={"Francês": "C1"}), edital)
        self.assertTrue(result["elegivel"])

    def test_simulation_does_not_mutate_inputs(self):
        profile, edital = complete_profile(), opportunity()
        original = deepcopy((profile, edital))
        simulate(profile, edital)
        self.assertEqual((profile, edital), original)

    def test_deadline_inclusive_and_inactive(self):
        edital = opportunity()
        edital["data_limite"] = today().isoformat()
        self.assertTrue(is_active(edital))
        self.assertFalse(is_active(edital, today() + timedelta(days=1)))
        edital["ativa"] = False
        self.assertFalse(is_active(edital))


if __name__ == "__main__":
    unittest.main()

